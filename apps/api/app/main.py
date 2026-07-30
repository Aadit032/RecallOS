"""
RecallOS FastAPI backend.

Primary API on PORT (default 3000). Better Auth OAuth can remain on a Node
sidecar; set AUTH_PROXY_URL to reverse-proxy /api/auth/* to it.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

import httpx
import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db import close_pool, init_pool
from app.routers import chat, connectors, download, memories, projects, search, upload
from app.services.connectors import run_due_connector_syncs

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("recallos.api")


async def _connector_loop(stop: asyncio.Event) -> None:
    settings = get_settings()
    interval = max(15.0, settings.connector_sync_poll_ms / 1000.0)
    while not stop.is_set():
        try:
            n = await run_due_connector_syncs(5)
            if n:
                logger.info("Continuous sync ran %s connector(s)", n)
        except Exception:
            logger.exception("connector sync loop error")
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except asyncio.TimeoutError:
            pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_pool()
    stop = asyncio.Event()
    task = asyncio.create_task(_connector_loop(stop))
    logger.info("RecallOS FastAPI ready")
    yield
    stop.set()
    task.cancel()
    await close_pool()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="RecallOS API", version="2.1.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_url],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(upload.router)
    app.include_router(download.router)
    app.include_router(search.router)
    app.include_router(chat.router)
    app.include_router(projects.router)
    app.include_router(memories.router)
    app.include_router(connectors.router)

    @app.get("/health")
    async def health():
        return {"ok": True, "backend": "fastapi"}

    # Optional reverse-proxy for Better Auth Node sidecar
    @app.api_route(
        "/api/auth/{path:path}",
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    )
    async def auth_proxy(path: str, request: Request):
        if not settings.auth_proxy_url:
            return Response(
                content='{"message":"Set AUTH_PROXY_URL to the Node Better Auth host, '
                'or run apps/backend for /api/auth"}',
                status_code=501,
                media_type="application/json",
            )
        url = f"{settings.auth_proxy_url.rstrip('/')}/api/auth/{path}"
        if request.url.query:
            url = f"{url}?{request.url.query}"
        body = await request.body()
        headers = {
            k: v
            for k, v in request.headers.items()
            if k.lower() not in ("host", "content-length")
        }
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=False) as client:
            upstream = await client.request(
                request.method, url, content=body, headers=headers
            )
        return Response(
            content=upstream.content,
            status_code=upstream.status_code,
            headers={
                k: v
                for k, v in upstream.headers.items()
                if k.lower()
                not in ("content-encoding", "transfer-encoding", "content-length")
            },
            media_type=upstream.headers.get("content-type"),
        )

    return app


app = create_app()


def run() -> None:
    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=settings.port,
        reload=False,
    )


if __name__ == "__main__":
    run()
