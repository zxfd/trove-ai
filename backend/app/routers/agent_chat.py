"""阶段⑤ 统一入口 —— 带记忆的知识管理 Agent 对话。

POST /api/agent/chat ：一个入口，隐式路由（所有能力都是工具，交给同一个 ReAct
循环让 LLM 自己选），带短期记忆（会话历史）+ 长期记忆（用户画像注入）。
SSE 流式，先吐一个 session 事件（带 session_id）方便前端续上下文。
"""
import json
import logging
from typing import AsyncIterator, Optional
from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.database import async_session
from app.dependencies import get_current_user
from app.models import User
from app.services.agent_memory import get_or_create_session
from app.services.tool_agent import (
    run_tool_agent, _execute_tool, _summarize_result, WRITE_TOOLS,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["agent-chat"])


class ChatBody(BaseModel):
    query: str = Field(..., min_length=1)
    session_id: Optional[str] = Field(default=None, description="续上一次对话；不给则开新会话")
    confirmed: bool = Field(default=False, description="true 时放行写工具（用户点了'执行'）")


class ExecuteBody(BaseModel):
    name: str = Field(..., description="要执行的写工具名（来自 confirm 事件）")
    args: dict = Field(default_factory=dict, description="写工具参数（来自 confirm 事件）")
    session_id: Optional[str] = Field(default=None, description="所属会话；用于把'已完成'写回记忆，了结待确认状态")


def _sse(ev: dict) -> bytes:
    return f"data: {json.dumps(ev, ensure_ascii=False)}\n\n".encode("utf-8")


async def _chat_stream(query: str, user_id, session_id: Optional[str], confirmed: bool) -> AsyncIterator[bytes]:
    async with async_session() as db:
        session = await get_or_create_session(db, user_id, session_id, query)
        # 先告诉前端用 session_id，下一轮带回来即可续上下文
        yield _sse({"stage": "session", "message": "会话已就绪", "data": {"session_id": str(session.id)}})
        async for ev in run_tool_agent(
            db, query, user_id, confirmed=confirmed, session_id=str(session.id)
        ):
            yield _sse(ev)


@router.post("/api/agent/chat")
async def agent_chat(
    body: ChatBody,
    current_user: User = Depends(get_current_user),
):
    """统一的知识管理 Agent 对话入口（隐式路由 + 记忆）。"""
    return StreamingResponse(
        _chat_stream(body.query, current_user.id, body.session_id, body.confirmed),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/api/agent/execute")
async def agent_execute(
    body: ExecuteBody,
    current_user: User = Depends(get_current_user),
):
    """用户点「确认执行」后，**直接执行那一个已经确定的写操作**（不重跑 agent）。

    confirm 事件已带回精确的 name + args（含 article_ids/folder_name 等），这里
    直接以 confirmed=True 执行，避免重新搜索/推理，又快又稳。只允许写工具。"""
    if body.name not in WRITE_TOOLS:
        return {"ok": False, "error": f"'{body.name}' 不是可确认执行的写工具"}
    async with async_session() as db:
        result = await _execute_tool(body.name, body.args, db, current_user.id, confirmed=True)
        ok = "error" not in result
        summary = _summarize_result(body.name, result)
        # 把"已完成"写回会话记忆，了结上一条悬空的"请确认"，避免下个问题又被旧任务带偏
        if body.session_id and ok:
            try:
                from app.services.agent_memory import save_turn
                await save_turn(db, UUID(str(body.session_id)), "确认执行", f"已完成：{summary}")
            except Exception as e:
                logger.warning(f"execute save_turn failed: {e}")
    return {"ok": ok, "summary": summary, "result": result}
