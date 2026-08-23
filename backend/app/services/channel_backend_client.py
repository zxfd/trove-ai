"""Authenticated calls from channel adapters back into Trove's user APIs."""
import json
from typing import Optional
from uuid import UUID

import httpx


class ChannelBackendClient:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.token = token

    def headers(self, user_id: UUID, json_content: bool = True) -> dict:
        result = {"Authorization": f"Bearer {self.token}", "X-Act-As-User": str(user_id)}
        if json_content:
            result["Content-Type"] = "application/json"
        return result

    async def add_url(self, user_id: UUID, url: str) -> str:
        async with httpx.AsyncClient(timeout=180) as client:
            response = await client.post(
                f"{self.base_url}/api/articles", headers=self.headers(user_id), json={"url": url}
            )
        if response.status_code == 201:
            return f"已添加：{(response.json().get('title') or '未命名')[:60]}"
        if response.status_code == 409:
            return "这条内容已经在知识库里了"
        return f"添加失败（HTTP {response.status_code}）"

    async def upload(self, user_id: UUID, filename: str, content: bytes, content_type: str) -> str:
        async with httpx.AsyncClient(timeout=240) as client:
            response = await client.post(
                f"{self.base_url}/api/articles/upload",
                headers=self.headers(user_id, json_content=False),
                files={"file": (filename, content, content_type)},
            )
        if response.status_code == 201:
            return f"文件已入库：{(response.json().get('title') or filename)[:60]}"
        try:
            detail = response.json().get("detail", "")
        except Exception:
            detail = ""
        return f"文件入库失败（HTTP {response.status_code}）：{detail[:100]}"

    async def agent(self, user_id: UUID, query: str) -> str:
        return (await self.agent_result(user_id, query)).get("text") or "Agent 没有返回可展示的文字。"

    async def agent_result(self, user_id: UUID, query: str, session_id: Optional[str] = None) -> dict:
        result = await self._agent_stream(user_id, query, "/api/agent/chat", session_id)
        if result is None:
            result = await self._agent_stream(user_id, query, "/api/research/agent", None)
        return result or {"text": "Agent 已处理，但没有返回可展示的文字。"}

    async def _agent_stream(self, user_id: UUID, query: str, endpoint: str, session_id: Optional[str]) -> Optional[dict]:
        final = ""
        pending = None
        active_session = session_id
        async with httpx.AsyncClient(timeout=300) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}{endpoint}",
                headers=self.headers(user_id),
                json={"query": query, **({"session_id": session_id} if session_id else {})},
            ) as response:
                if response.status_code == 404:
                    return None
                if response.status_code != 200:
                    return f"Agent 暂时不可用（HTTP {response.status_code}）"
                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    try:
                        event = json.loads(line[6:])
                    except Exception:
                        continue
                    stage = event.get("stage")
                    if stage == "session":
                        active_session = (event.get("data") or {}).get("session_id") or active_session
                    elif stage in {"answer", "final", "done"}:
                        final = event.get("message") or event.get("content") or final
                        final = (event.get("data") or {}).get("answer") or final
                    elif stage == "confirm":
                        final = (event.get("message") or "需要确认后才能执行这项写操作") + "\n回复“确认”或“执行”后才会修改知识库。"
                        pending = {"name": (event.get("data") or {}).get("name"), "args": (event.get("data") or {}).get("args") or {}}
                    elif stage == "error":
                        final = event.get("message") or "Agent 处理失败"
        return {"text": final, "pending": pending, "session_id": active_session}

    async def execute(self, user_id: UUID, pending: dict, session_id: Optional[str]) -> str:
        async with httpx.AsyncClient(timeout=180) as client:
            response = await client.post(
                f"{self.base_url}/api/agent/execute", headers=self.headers(user_id),
                json={"name": pending.get("name"), "args": pending.get("args") or {}, "session_id": session_id},
            )
        if response.status_code != 200:
            return f"执行失败（HTTP {response.status_code}）"
        data = response.json()
        if data.get("ok"):
            return f"已执行：{data.get('summary') or '完成'}"
        return f"执行失败：{data.get('error') or data.get('summary') or '未知错误'}"
