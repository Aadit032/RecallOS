from __future__ import annotations

import os
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()


class Settings:
    database_url: str = os.getenv(
        "DATABASE_URL", "postgresql://postgres:password@localhost:5432/recallOs"
    )
    # asyncpg wants postgresql:// not prisma's postgresql:// with query params sometimes
    port: int = int(os.getenv("PORT", "3000"))
    frontend_url: str = os.getenv("FRONTEND_URL", "http://localhost:3001")
    better_auth_url: str = os.getenv("BETTER_AUTH_URL", "http://localhost:3000")
    # Optional Node Better Auth sidecar for OAuth (if set, /api/auth is proxied)
    auth_proxy_url: str = os.getenv("AUTH_PROXY_URL", "")

    aws_bucket_name: str = os.getenv("AWS_BUCKET_NAME", "recallos")
    minio_endpoint: str = os.getenv("MINIO_ENDPOINT", "http://localhost:9000")
    minio_access_key: str = os.getenv("MINIO_ACCESSKEYID", "admin")
    minio_secret_key: str = os.getenv("MINIO_SECRET_ACCESS_KEY", "password123")

    redis_url: str = os.getenv("REDIS_URL", "redis://localhost:6379")
    files_stream: str = os.getenv("FILES_STREAM", "files_stream")
    embed_stream: str = os.getenv("EMBED_STREAM", "embed_stream")

    qdrant_host: str = os.getenv("HOST", "localhost")
    qdrant_port: int = int(os.getenv("QDRANT_PORT", "6333"))
    collection: str = os.getenv("COLLECTION", "recallos")

    openrouter_api_key: str = os.getenv("OPENROUTER_API_KEY", "")
    chat_model: str = os.getenv("CHAT_MODEL") or os.getenv("CONTEXT_MODEL") or "openai/gpt-4o-mini"
    hf_token: str = os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACE_API_KEY") or ""
    cross_encoder_model: str = os.getenv(
        "CROSS_ENCODER_MODEL", "cross-encoder/ms-marco-MiniLM-L6-v2"
    )
    exa_api_key: str = os.getenv("EXA_API_KEY", "")

    connector_sync_poll_ms: int = int(os.getenv("CONNECTOR_SYNC_POLL_MS", "60000"))

    def async_database_url(self) -> str:
        url = self.database_url
        if url.startswith("postgresql://"):
            return url.replace("postgresql://", "postgresql://", 1)
        if url.startswith("postgres://"):
            return url.replace("postgres://", "postgresql://", 1)
        return url


@lru_cache
def get_settings() -> Settings:
    return Settings()
