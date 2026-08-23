"""阶段⑤ Agent 记忆层 —— 短期(会话历史) + 长期(用户画像/偏好/事实)。

设计取舍（教学用，刻意简单）：
- 短期：只存对话轮（user / assistant 的最终文本），不存中间工具调用。
  这样历史是干净的多轮对话，replay 进 ReAct 循环既省 token 又符合 OpenAI 消息格式。
- 长期：结构化表 + 每次对话开头全量注入系统提示词。V1 不上向量记忆库，够用且好调试。
"""
import logging
from typing import List, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AgentSession, AgentMessage, UserMemory

logger = logging.getLogger("trove.agent-memory")

HISTORY_MAX_MESSAGES = 20   # 最多带回最近 N 条对话消息（控制 token）
LONG_TERM_MAX = 30          # 最多注入 N 条长期记忆


# ── 会话（短期记忆容器）────────────────────────────────────────────
async def get_or_create_session(
    db: AsyncSession,
    user_id: UUID,
    session_id: Optional[str] = None,
    first_query: str = "",
) -> AgentSession:
    """有 session_id 就取（校验属于该用户），否则新建一个，标题取首问前 30 字。"""
    if session_id:
        try:
            sid = UUID(str(session_id))
        except (ValueError, TypeError):
            sid = None
        if sid:
            s = (await db.execute(
                select(AgentSession).where(
                    AgentSession.id == sid, AgentSession.user_id == user_id
                )
            )).scalar_one_or_none()
            if s:
                return s
    title = (first_query or "新对话").strip()[:30]
    s = AgentSession(user_id=user_id, title=title)
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return s


async def load_history(db: AsyncSession, session_id: UUID, user_id: UUID) -> List[dict]:
    """取该会话最近 N 条对话消息，按时间正序返回成 [{role, content}, ...]。

    防御纵深：先校验这个会话确实属于 user_id，不属于就返回空——哪怕调用方
    绕过了入口的归属校验，跨用户也读不到别人的会话历史。"""
    owns = (await db.execute(
        select(AgentSession.id).where(
            AgentSession.id == session_id, AgentSession.user_id == user_id
        )
    )).scalar_one_or_none()
    if not owns:
        logger.warning(f"load_history blocked: session {session_id} not owned by user {user_id}")
        return []

    rows = (await db.execute(
        select(AgentMessage)
        .where(AgentMessage.session_id == session_id)
        .order_by(AgentMessage.created_at.desc())
        .limit(HISTORY_MAX_MESSAGES)
    )).scalars().all()
    rows = list(reversed(rows))   # 回到时间正序
    return [{"role": m.role, "content": m.content or ""} for m in rows]


async def save_turn(
    db: AsyncSession, session_id: UUID, user_query: str, assistant_answer: str
) -> None:
    """一轮对话结束后落库：用户这句 + 助手最终回答。"""
    db.add(AgentMessage(session_id=session_id, role="user", content=user_query))
    db.add(AgentMessage(session_id=session_id, role="assistant", content=assistant_answer))
    await db.commit()


# ── 长期记忆（用户画像/偏好/事实）──────────────────────────────────
async def load_long_term_block(db: AsyncSession, user_id: UUID) -> str:
    """读出该用户的长期记忆，拼成一段注入系统提示词的文本。无则返回空串。"""
    rows = (await db.execute(
        select(UserMemory)
        .where(UserMemory.user_id == user_id)
        .order_by(UserMemory.created_at.asc())
        .limit(LONG_TERM_MAX)
    )).scalars().all()
    if not rows:
        return ""
    lines = [f"- （{m.kind}）{m.content}" for m in rows if (m.content or "").strip()]
    if not lines:
        return ""
    return "\n\n【关于这个用户，你已经知道】\n" + "\n".join(lines)


async def add_user_memory(
    db: AsyncSession,
    user_id: UUID,
    content: str,
    kind: str = "fact",
    source: str = "agent",
) -> dict:
    """写一条长期记忆。幂等：同用户已有完全相同 content 则跳过，避免重复污染。"""
    text = (content or "").strip()
    if not text:
        return {"error": "memory content is empty"}
    if kind not in ("profile", "preference", "fact"):
        kind = "fact"

    dup = (await db.execute(
        select(UserMemory).where(
            UserMemory.user_id == user_id, UserMemory.content == text
        )
    )).scalar_one_or_none()
    if dup:
        return {"status": "already remembered", "kind": dup.kind, "content": text}

    m = UserMemory(user_id=user_id, kind=kind, content=text, source=source)
    db.add(m)
    await db.commit()
    return {"status": "ok", "kind": kind, "content": text}
