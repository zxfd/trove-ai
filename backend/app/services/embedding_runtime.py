"""Robust embedding runtime for Trove AI.

Goals:
- keep the database's existing 1024-dim vector space;
- never fall back to an unrelated embedding model (that would make similarity
  search mathematically invalid);
- allow the configured SiliconFlow BAAI/bge-m3 API to fall back to the *same*
  BGE-M3 model locally when the API is unavailable or refuses the request;
- make fresh local installs use a 1024-dim multilingual model by default.

FastEmbed Python does not yet ship BAAI/bge-m3 in its native registry, but it
supports custom ONNX models.  The registration below mirrors the upstream
FastEmbed BGE-M3 proposal: CLS pooling + normalization, 1024 dimensions,
BAAI/bge-m3's ONNX graph plus its external data file.
"""
from __future__ import annotations

import logging
from types import MethodType
from typing import Any, Optional

import httpx

from app.config_manager import CONFIG_SCHEMA, get_embedding_config
from app.services.ai_service import llm_service

logger = logging.getLogger("trove.embedding-runtime")

VECTOR_DIM = 1024
LOCAL_DEFAULT_MODEL = "BAAI/bge-m3"
_LOCAL_MODELS: dict[str, Any] = {}


class EmbeddingRuntimeError(RuntimeError):
    pass


def _register_bge_m3_if_needed() -> None:
    """Register BGE-M3 in FastEmbed's custom-model registry if necessary."""
    from fastembed import TextEmbedding

    supported = {m.get("model", "").lower() for m in TextEmbedding.list_supported_models()}
    if LOCAL_DEFAULT_MODEL.lower() in supported:
        return

    from fastembed.common.model_description import ModelSource, PoolingType

    TextEmbedding.add_custom_model(
        model=LOCAL_DEFAULT_MODEL,
        pooling=PoolingType.CLS,
        normalization=True,
        sources=ModelSource(hf=LOCAL_DEFAULT_MODEL),
        dim=VECTOR_DIM,
        model_file="onnx/model.onnx",
        additional_files=["onnx/model.onnx_data"],
        description="BGE-M3 multilingual dense embeddings (local ONNX fallback)",
        license="mit",
        size_in_gb=2.27,
    )
    logger.info("Registered FastEmbed custom model %s", LOCAL_DEFAULT_MODEL)


def _get_local_model(model_name: str):
    from fastembed import TextEmbedding

    if model_name == LOCAL_DEFAULT_MODEL:
        _register_bge_m3_if_needed()

    model = _LOCAL_MODELS.get(model_name)
    if model is None:
        logger.info("Loading local embedding model %s", model_name)
        model = TextEmbedding(model_name=model_name)
        dim = getattr(model, "embedding_size", None)
        if dim is None:
            dim = TextEmbedding.get_embedding_size(model_name)
        if int(dim) != VECTOR_DIM:
            raise EmbeddingRuntimeError(
                f"本地 embedding 模型 {model_name} 输出 {dim} 维，但数据库固定为 {VECTOR_DIM} 维。"
            )
        _LOCAL_MODELS[model_name] = model
        logger.info("Local embedding model ready: %s (%s dims)", model_name, dim)
    return model


def _local_embedding(text: str, model_name: str, emb_type: str = "db") -> list[float]:
    model = _get_local_model(model_name)
    text = (text or "")[:12000]
    if emb_type == "query" and hasattr(model, "query_embed"):
        rows = list(model.query_embed([text]))
    elif emb_type != "query" and hasattr(model, "passage_embed"):
        rows = list(model.passage_embed([text]))
    else:
        rows = list(model.embed([text]))
    if not rows:
        raise EmbeddingRuntimeError(f"本地 embedding 模型 {model_name} 未返回向量")
    vector = rows[0].tolist() if hasattr(rows[0], "tolist") else list(rows[0])
    if len(vector) != VECTOR_DIM:
        raise EmbeddingRuntimeError(
            f"本地 embedding 模型 {model_name} 实际输出 {len(vector)} 维，期望 {VECTOR_DIM} 维。"
        )
    return vector


async def _api_embedding(config: dict[str, Any], text: str, emb_type: str) -> list[float]:
    provider = (config.get("provider") or "").lower()
    api_key = config.get("api_key") or ""
    api_base = (config.get("api_base") or "").rstrip("/")
    model = config.get("model") or ""

    if not api_key or not api_base or not model:
        raise EmbeddingRuntimeError("Embedding API 配置不完整（api_key / api_base / model）")

    if provider == "minimax":
        url = f"{api_base}/v1/embeddings"
        payload = {"model": model or "embo-01", "texts": [text], "type": emb_type}
    else:
        url = f"{api_base}/embeddings"
        payload = {"model": model, "input": text, "encoding_format": "float"}

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )

    if resp.status_code != 200:
        body = resp.text[:500]
        raise EmbeddingRuntimeError(
            f"Embedding API HTTP {resp.status_code} (model={model}): {body}"
        )

    data = resp.json()
    vector: list[Any] = []
    if isinstance(data.get("data"), list) and data["data"]:
        vector = data["data"][0].get("embedding") or []
    elif isinstance(data.get("vectors"), list) and data["vectors"]:
        # Compatibility with providers that return {vectors:[[...]]}.
        vector = data["vectors"][0]

    if not vector:
        raise EmbeddingRuntimeError(
            f"Embedding API 返回格式异常 (model={model}): {str(data)[:300]}"
        )
    if len(vector) != VECTOR_DIM:
        raise EmbeddingRuntimeError(
            f"Embedding API 模型 {model} 输出 {len(vector)} 维，但数据库固定为 {VECTOR_DIM} 维。"
        )
    return [float(v) for v in vector]


async def _get_embedding(self, text: str, emb_type: str = "db") -> list[float]:
    """Patched LLMService.get_embedding with vector-space-safe fallback."""
    cfg = get_embedding_config()
    provider = (cfg.get("provider") or "local").lower()
    model = cfg.get("model") or LOCAL_DEFAULT_MODEL

    if provider == "local":
        return _local_embedding(text, model, emb_type)

    try:
        return await _api_embedding(cfg, text, emb_type)
    except Exception as api_exc:
        # A fallback is valid only if it uses the exact same embedding model.
        # Using a different model would mix incompatible vector spaces with the
        # already stored vectors and silently destroy semantic-search quality.
        logger.warning("Embedding API failed; trying same-model local fallback: %s", api_exc)
        try:
            return _local_embedding(text, model, emb_type)
        except Exception as local_exc:
            raise EmbeddingRuntimeError(
                f"{api_exc}; 同模型本地 fallback 也失败: {local_exc}"
            ) from local_exc


async def test_embedding_connection(config: Optional[dict[str, Any]] = None) -> dict:
    """Connectivity test that also validates the required 1024 dimensions."""
    import time

    cfg = dict(config or get_embedding_config())
    provider = (cfg.get("provider") or "local").lower()
    model = cfg.get("model") or LOCAL_DEFAULT_MODEL
    t0 = time.time()

    try:
        if provider == "local":
            vector = _local_embedding("test", model, "query")
            latency = round((time.time() - t0) * 1000)
            return {
                "ok": True,
                "error": None,
                "latency_ms": latency,
                "detail": f"本地模型可用：{model}，{len(vector)} 维 ({latency}ms)",
            }

        try:
            vector = await _api_embedding(cfg, "test", "query")
            latency = round((time.time() - t0) * 1000)
            return {
                "ok": True,
                "error": None,
                "latency_ms": latency,
                "detail": f"API 可用：{model}，{len(vector)} 维 ({latency}ms)",
            }
        except Exception as api_exc:
            vector = _local_embedding("test", model, "query")
            latency = round((time.time() - t0) * 1000)
            return {
                "ok": True,
                "error": None,
                "latency_ms": latency,
                "detail": (
                    f"API 不可用，但同模型本地 fallback 可用：{model}，{len(vector)} 维 "
                    f"({latency}ms)；API 原因：{api_exc}"
                ),
            }
    except Exception as exc:
        return {
            "ok": False,
            "error": f"Embedding 不可用: {exc}",
            "latency_ms": round((time.time() - t0) * 1000),
        }


def install_embedding_runtime() -> None:
    """Install runtime patches before routers import their function references."""
    import app.config_manager as config_manager

    # Fix the broken fresh-install default: DB vector column is vector(1024), so
    # the old 384-dim BAAI/bge-small-en-v1.5 default could never be stored.
    schema = CONFIG_SCHEMA.get("embedding", {})
    for field in schema.get("fields", []):
        if field.get("key") == "model" and field.get("default") == "BAAI/bge-small-en-v1.5":
            field["default"] = LOCAL_DEFAULT_MODEL
            field["placeholder"] = LOCAL_DEFAULT_MODEL

    llm_service.get_embedding = MethodType(_get_embedding, llm_service)
    config_manager.test_embedding_connection = test_embedding_connection
    logger.info("Installed robust embedding runtime (vector_dim=%s)", VECTOR_DIM)
