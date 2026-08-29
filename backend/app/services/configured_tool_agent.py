"""Tool-agent LLM adapter that uses the configured primary chat model.

The legacy tool_agent module originally hardcoded SiliconFlow DeepSeek-V3 and
reused the embedding API key.  That meant Tool Agent could incur paid chat
usage even when every model selected in Settings was free.

This module keeps the mature tool loop/tool implementations intact, but
replaces only its LLM transport with the same `llm` configuration used by the
rest of Trove AI.  There is deliberately no silent provider/model fallback:
if the configured chat model cannot do OpenAI-compatible tool calling, the
request fails with an actionable error instead of switching to a paid model.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Dict, List

import httpx

from app.config_manager import get_llm_config
from app.services import tool_agent as _legacy

logger = logging.getLogger("trove.tool-agent.configured-llm")

RETRY_STATUS_CODES = {408, 409, 425, 429, 500, 502, 503, 504}
RETRY_DELAYS = (1.0, 2.0)

# Preserve the legacy loop's special handling for temporary upstream failures.
AgentLLMBusyError = _legacy.LLMServiceBusyError


def _agent_llm_config() -> tuple[str, str, str]:
    """Return (api_base, api_key, model) from the primary LLM settings.

    We intentionally do *not* read the embedding group or SILICONFLOW_API_KEY.
    Tool Agent must obey the model/provider selected under AI 对话模型.
    """
    cfg = get_llm_config()
    api_base = (cfg.get("api_base") or "").rstrip("/")
    api_key = cfg.get("api_key") or ""
    model = cfg.get("model") or ""

    missing = [
        name
        for name, value in (("api_base", api_base), ("api_key", api_key), ("model", model))
        if not value
    ]
    if missing:
        raise RuntimeError(
            "Tool Agent 未配置可用的 AI 对话模型：缺少 " + ", ".join(missing)
        )
    return api_base, api_key, model


def _headers(api_key: str) -> dict:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def _agent_error(status_code: int, body: str, model: str) -> RuntimeError:
    detail = (body or "")[:400]
    return RuntimeError(
        f"Tool Agent LLM HTTP {status_code} (model={model}): {detail}. "
        "Tool Agent 只使用『系统设置 → AI 对话模型』中的模型，不会自动切换到其他收费模型。"
        "若该模型不支持 OpenAI-compatible tools/function calling，请在 AI 对话模型中换成支持工具调用的模型。"
    )


async def _call_llm_with_tools(messages: list, tools: list) -> dict:
    """Non-streaming OpenAI-compatible tool-call request using primary LLM config."""
    api_base, api_key, model = _agent_llm_config()
    payload = {
        "model": model,
        "messages": messages,
        "tools": tools,
        "tool_choice": "auto",
        "temperature": 0.3,
        "max_tokens": 2048,
    }

    async with httpx.AsyncClient(timeout=120) as client:
        last_error = ""
        for attempt in range(len(RETRY_DELAYS) + 1):
            resp = await client.post(
                f"{api_base}/chat/completions",
                headers=_headers(api_key),
                json=payload,
            )
            if resp.status_code == 200:
                data = resp.json()
                choice = (data.get("choices") or [{}])[0]
                return choice.get("message") or {}

            last_error = resp.text[:400]
            if resp.status_code in RETRY_STATUS_CODES and attempt < len(RETRY_DELAYS):
                delay = RETRY_DELAYS[attempt]
                logger.warning(
                    "agent LLM busy status=%s model=%s attempt=%s retry_in=%.1fs body=%s",
                    resp.status_code,
                    model,
                    attempt + 1,
                    delay,
                    last_error,
                )
                await asyncio.sleep(delay)
                continue
            if resp.status_code in RETRY_STATUS_CODES:
                raise AgentLLMBusyError(
                    f"Tool Agent LLM temporarily unavailable ({resp.status_code}, model={model}): {last_error}"
                )
            raise _agent_error(resp.status_code, last_error, model)

    raise AgentLLMBusyError(
        f"Tool Agent LLM temporarily unavailable (model={model}): {last_error}"
    )


async def _stream_llm_with_tools(messages: list, tools: list, tool_choice: str = "auto"):
    """Streaming OpenAI-compatible tool-call request using primary LLM config.

    Yields the exact event contract expected by legacy run_tool_agent:
    ("token", delta_text) followed by ("done", {content, tool_calls}).
    """
    api_base, api_key, model = _agent_llm_config()
    payload = {
        "model": model,
        "messages": messages,
        "tools": tools,
        "tool_choice": tool_choice,
        "temperature": 0.3,
        "max_tokens": 2048,
        "stream": True,
    }

    async with httpx.AsyncClient(timeout=120) as client:
        last_error = ""
        for attempt in range(len(RETRY_DELAYS) + 1):
            content_parts: List[str] = []
            tc_acc: Dict[int, dict] = {}

            async with client.stream(
                "POST",
                f"{api_base}/chat/completions",
                headers=_headers(api_key),
                json=payload,
            ) as resp:
                if resp.status_code != 200:
                    body = (await resp.aread()).decode("utf-8", "ignore")[:400]
                    last_error = body

                    # A few OpenAI-compatible providers accept tools but not
                    # tool_choice="required".  The legacy loop only uses
                    # "required" as a one-off nudge, so falling back to "auto"
                    # here preserves capability without changing providers.
                    if resp.status_code == 400 and payload.get("tool_choice") == "required":
                        logger.warning(
                            "agent LLM model=%s rejected tool_choice=required; retrying with auto",
                            model,
                        )
                        payload["tool_choice"] = "auto"
                        continue

                    if resp.status_code in RETRY_STATUS_CODES and attempt < len(RETRY_DELAYS):
                        delay = RETRY_DELAYS[attempt]
                        logger.warning(
                            "agent LLM stream busy status=%s model=%s attempt=%s retry_in=%.1fs body=%s",
                            resp.status_code,
                            model,
                            attempt + 1,
                            delay,
                            body,
                        )
                        await asyncio.sleep(delay)
                        continue
                    if resp.status_code in RETRY_STATUS_CODES:
                        raise AgentLLMBusyError(
                            f"Tool Agent LLM temporarily unavailable ({resp.status_code}, model={model}): {body}"
                        )
                    raise _agent_error(resp.status_code, body, model)

                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except Exception:
                        continue
                    choices = chunk.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    dc = delta.get("content")
                    if dc:
                        content_parts.append(dc)
                        yield ("token", dc)
                    for tc in delta.get("tool_calls") or []:
                        idx = tc.get("index", 0)
                        acc = tc_acc.setdefault(idx, {"id": "", "name": "", "args": ""})
                        if tc.get("id"):
                            acc["id"] = tc["id"]
                        fn = tc.get("function") or {}
                        if fn.get("name"):
                            acc["name"] = fn["name"]
                        if fn.get("arguments"):
                            acc["args"] += fn["arguments"]
                break
        else:
            raise AgentLLMBusyError(
                f"Tool Agent LLM temporarily unavailable (model={model}): {last_error}"
            )

    tool_calls = [
        {
            "id": value["id"] or f"call_{idx}",
            "type": "function",
            "function": {"name": value["name"], "arguments": value["args"]},
        }
        for idx, value in sorted(tc_acc.items())
        if value["name"]
    ]
    yield ("done", {"content": "".join(content_parts), "tool_calls": tool_calls})


# Patch the transport once at import time.  run_tool_agent resolves these globals
# dynamically inside the legacy module, so all subsequent calls through the
# research endpoint use the configured primary LLM and never the old SF route.
_legacy._call_llm_with_tools = _call_llm_with_tools
_legacy._stream_llm_with_tools = _stream_llm_with_tools

run_tool_agent = _legacy.run_tool_agent
