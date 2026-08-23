"""Small Feishu Open Platform client used by the webhook channel adapter."""
import json
import time
from typing import Optional

import httpx
from app.config_manager import get_effective_config


class LarkClient:
    def __init__(self, config: Optional[dict] = None):
        self.config = config or get_effective_config("lark")
        self._token = ""
        self._expires_at = 0.0

    async def tenant_token(self) -> str:
        if self._token and time.time() < self._expires_at:
            return self._token
        async with httpx.AsyncClient(timeout=15, trust_env=False) as client:
            response = await client.post("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", json={
                "app_id": self.config.get("app_id"), "app_secret": self.config.get("app_secret")
            })
        response.raise_for_status()
        data = response.json()
        if data.get("code") != 0 or not data.get("tenant_access_token"):
            raise RuntimeError(data.get("msg") or "Feishu token request failed")
        self._token = data["tenant_access_token"]
        self._expires_at = time.time() + int(data.get("expire", 7200)) - 120
        return self._token

    async def send_text(self, chat_id: str, text: str) -> None:
        token = await self.tenant_token()
        async with httpx.AsyncClient(timeout=20, trust_env=False) as client:
            for chunk in ([text[i:i + 3500] for i in range(0, len(text), 3500)] or [""]):
                response = await client.post(
                    "https://open.feishu.cn/open-apis/im/v1/messages",
                    params={"receive_id_type": "chat_id"}, headers={"Authorization": f"Bearer {token}"},
                    json={"receive_id": chat_id, "msg_type": "text", "content": json.dumps({"text": chunk}, ensure_ascii=False)},
                )
                response.raise_for_status()
                if response.json().get("code") != 0:
                    raise RuntimeError(response.json().get("msg") or "Feishu send failed")

    async def download_resource(self, message_id: str, file_key: str, resource_type: str) -> bytes:
        token = await self.tenant_token()
        async with httpx.AsyncClient(timeout=90, trust_env=False) as client:
            response = await client.get(
                f"https://open.feishu.cn/open-apis/im/v1/messages/{message_id}/resources/{file_key}",
                params={"type": resource_type}, headers={"Authorization": f"Bearer {token}"},
            )
        response.raise_for_status()
        return response.content


async def test_lark_connection(config: Optional[dict] = None) -> dict:
    config = config or get_effective_config("lark")
    if str(config.get("enabled", "false")).lower() != "true":
        return {"ok": True, "message": "飞书 Bot 已关闭"}
    if not config.get("app_id") or not config.get("app_secret") or not config.get("verification_token"):
        return {"ok": False, "error": "启用前请填写 App ID、App Secret 和 Verification Token"}
    try:
        await LarkClient(config).tenant_token()
        return {"ok": True, "message": "飞书应用凭证有效"}
    except Exception as exc:
        return {"ok": False, "error": f"飞书连接失败：{type(exc).__name__}"}
