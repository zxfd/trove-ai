"""Trove AI application package bootstrap."""

# Install embedding behavior before router modules import config/test helpers.
# This keeps the vector space 1024-dimensional and provides a same-model local
# BGE-M3 fallback when the configured API is unavailable.
from app.services.embedding_runtime import install_embedding_runtime

install_embedding_runtime()
