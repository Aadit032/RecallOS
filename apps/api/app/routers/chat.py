from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.agents.memory_agent import run_memory_agent
from app.auth import resolve_user_id
from app.db import get_pool
from app.services.chat import (
    build_system_prompt,
    is_agent_command,
    is_web_command,
    strip_agent_prefix,
    strip_web_prefix,
    summarize_chat,
    title_from_message,
)
from app.services.citations import grounded_sources
from app.services.embed import cross_encode_rerank
from app.services.hybrid_retrieve import hybrid_retrieve
from app.services.memory import extract_and_store_memories
from app.services.openrouter import chat_completion, _stream
from app.config import get_settings

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])

RERANK_TOP_K = 5


class MessageBody(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    chatId: str | None = None
    userAgent: str | None = None
    modality: str | None = None
    agentMode: bool | None = None


class PatchChatBody(BaseModel):
    title: str | None = None
    pinned: bool | None = None
    projectId: str | None = None


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, default=str)}\n\n"


@router.get("/")
async def list_chats(
    user_id: str = Depends(resolve_user_id),
    limit: int = Query(default=20, ge=1, le=50),
    cursor: str | None = None,
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT c.*, p.name AS project_name,
              (SELECT COUNT(*) FROM "Message" m WHERE m."chatId" = c.id) AS message_count
            FROM "Chat" c
            LEFT JOIN "Project" p ON p.id = c."projectId"
            WHERE c."userId" = $1
            ORDER BY c.pinned DESC, c."updatedAt" DESC, c.id DESC
            LIMIT $2
            """,
            user_id,
            500,
        )
    # cursor pagination
    if cursor:
        ids = [str(r["id"]) for r in rows]
        if cursor in ids:
            rows = rows[ids.index(cursor) + 1 :]
    page = rows[:limit]
    has_more = len(rows) > limit
    chats = []
    for r in page:
        chats.append(
            {
                "id": str(r["id"]),
                "title": r["title"],
                "pinned": r["pinned"],
                "projectId": r["projectId"],
                "projectName": r["project_name"],
                "updatedAt": r["updatedAt"].isoformat() if r["updatedAt"] else None,
                "createdAt": r["createdAt"].isoformat() if r["createdAt"] else None,
                "messageCount": int(r["message_count"] or 0),
            }
        )
    next_cursor = chats[-1]["id"] if has_more and chats else None
    return {"chats": chats, "nextCursor": next_cursor, "hasMore": has_more}


@router.get("/{chat_id}")
async def get_chat(chat_id: str, user_id: str = Depends(resolve_user_id)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        chat = await conn.fetchrow(
            """
            SELECT c.*, p.id AS p_id, p.name AS p_name
            FROM "Chat" c
            LEFT JOIN "Project" p ON p.id = c."projectId"
            WHERE c.id = $1 AND c."userId" = $2
            """,
            chat_id,
            user_id,
        )
        if not chat:
            raise HTTPException(status_code=404, detail={"message": "Chat not found"})
        messages = await conn.fetch(
            """
            SELECT id, role, content, "sourceChunks", "createdAt"
            FROM "Message" WHERE "chatId" = $1 ORDER BY "createdAt" ASC
            """,
            chat_id,
        )
    msgs = []
    for m in messages:
        d = {
            "id": str(m["id"]),
            "role": m["role"],
            "content": m["content"],
            "sourceChunks": m["sourceChunks"],
            "createdAt": m["createdAt"].isoformat() if m["createdAt"] else None,
        }
        if isinstance(d["sourceChunks"], str):
            try:
                d["sourceChunks"] = json.loads(d["sourceChunks"])
            except json.JSONDecodeError:
                pass
        msgs.append(d)
    return {
        "chat": {
            "id": str(chat["id"]),
            "title": chat["title"],
            "pinned": chat["pinned"],
            "projectId": chat["projectId"],
            "project": {"id": chat["p_id"], "name": chat["p_name"]}
            if chat["p_id"]
            else None,
            "messages": msgs,
            "createdAt": chat["createdAt"].isoformat() if chat["createdAt"] else None,
            "updatedAt": chat["updatedAt"].isoformat() if chat["updatedAt"] else None,
        }
    }


@router.patch("/{chat_id}")
async def patch_chat(
    chat_id: str, body: PatchChatBody, user_id: str = Depends(resolve_user_id)
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        existing = await conn.fetchrow(
            'SELECT id FROM "Chat" WHERE id = $1 AND "userId" = $2', chat_id, user_id
        )
        if not existing:
            raise HTTPException(status_code=404, detail={"message": "Chat not found"})
        if body.title is not None:
            await conn.execute(
                'UPDATE "Chat" SET title = $2, "updatedAt" = NOW() WHERE id = $1',
                chat_id,
                body.title,
            )
        if body.pinned is not None:
            await conn.execute(
                'UPDATE "Chat" SET pinned = $2, "updatedAt" = NOW() WHERE id = $1',
                chat_id,
                body.pinned,
            )
        if body.projectId is not None:
            await conn.execute(
                'UPDATE "Chat" SET "projectId" = $2, "updatedAt" = NOW() WHERE id = $1',
                chat_id,
                body.projectId,
            )
        row = await conn.fetchrow('SELECT * FROM "Chat" WHERE id = $1', chat_id)
    d = dict(row)
    d["createdAt"] = d["createdAt"].isoformat()
    d["updatedAt"] = d["updatedAt"].isoformat()
    return {"chat": d}


@router.delete("/{chat_id}")
async def delete_chat(chat_id: str, user_id: str = Depends(resolve_user_id)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            'DELETE FROM "Chat" WHERE id = $1 AND "userId" = $2', chat_id, user_id
        )
    if not result.endswith("1"):
        raise HTTPException(status_code=404, detail={"message": "Chat not found"})
    return {"message": "Chat deleted"}


@router.post("/message")
async def post_message(
    body: MessageBody,
    request: Request,
    user_id: str = Depends(resolve_user_id),
):
    message = body.message
    web_mode = is_web_command(message)
    agent_mode = bool(body.agentMode) or is_agent_command(message)
    web_query = strip_web_prefix(message) if web_mode else ""
    agent_query = (
        strip_agent_prefix(message) if is_agent_command(message) else message
        if agent_mode
        else ""
    )

    if web_mode and not web_query:
        raise HTTPException(
            status_code=422,
            detail={"message": "Add a query after /web"},
        )
    if agent_mode and not agent_query:
        raise HTTPException(
            status_code=422,
            detail={"message": "Add a query after /agent"},
        )
    if web_mode and agent_mode:
        raise HTTPException(
            status_code=422, detail={"message": "Use either /web or /agent"}
        )

    pool = await get_pool()
    chat = None
    is_new = False
    project_prompt = None

    async with pool.acquire() as conn:
        if body.chatId:
            chat = await conn.fetchrow(
                """
                SELECT c.*, p."systemPrompt" AS project_prompt
                FROM "Chat" c
                LEFT JOIN "Project" p ON p.id = c."projectId"
                WHERE c.id = $1 AND c."userId" = $2
                """,
                body.chatId,
                user_id,
            )
            if not chat:
                raise HTTPException(
                    status_code=404, detail={"message": "Chat not found"}
                )
            project_prompt = chat["project_prompt"]
        else:
            is_new = True
            seed = web_query if web_mode else agent_query if agent_mode else message
            chat_id = str(uuid.uuid4())
            chat = await conn.fetchrow(
                """
                INSERT INTO "Chat" (id, title, "userId", "createdAt", "updatedAt")
                VALUES ($1,$2,$3,NOW(),NOW()) RETURNING *
                """,
                chat_id,
                title_from_message(seed),
                user_id,
            )
            chat = dict(chat)
            chat["project_prompt"] = None

    chat = dict(chat)
    chat_id = str(chat["id"])
    seed = web_query if web_mode else agent_query if agent_mode else message
    should_set_title = is_new or chat.get("title") == "New chat"
    title = title_from_message(seed) if should_set_title else chat.get("title")

    async with pool.acquire() as conn:
        user_msg = await conn.fetchrow(
            """
            INSERT INTO "Message" (id, role, content, "chatId", "createdAt")
            VALUES ($1,'user',$2,$3,NOW()) RETURNING *
            """,
            str(uuid.uuid4()),
            message,
            chat_id,
        )
    user_msg = dict(user_msg)

    async def event_stream() -> AsyncIterator[str]:
        mode = "web" if web_mode else "agent" if agent_mode else "memory"
        yield _sse(
            {
                "type": "meta",
                "chatId": chat_id,
                "title": title,
                "isNewSession": is_new,
                "mode": mode,
                "userMessage": {
                    "id": str(user_msg["id"]),
                    "role": "user",
                    "content": message,
                    "createdAt": user_msg["createdAt"].isoformat(),
                },
                "sources": [],
            }
        )

        assistant_text = ""
        sources: list[dict[str, Any]] = []

        try:
            if web_mode:
                # Lightweight web path: Exa if available, else note unavailable
                yield _sse(
                    {
                        "type": "status",
                        "message": "Web mode on FastAPI: use Node backend for full Exa agent, or /agent for library multi-hop.",
                        "mode": "web",
                    }
                )
                settings = get_settings()
                if settings.exa_api_key:
                    import httpx

                    async with httpx.AsyncClient(timeout=30.0) as client:
                        resp = await client.post(
                            "https://api.exa.ai/search",
                            headers={
                                "x-api-key": settings.exa_api_key,
                                "Content-Type": "application/json",
                            },
                            json={
                                "query": web_query,
                                "numResults": 5,
                                "contents": {"text": True},
                            },
                        )
                        data = resp.json() if resp.status_code == 200 else {}
                    hits = data.get("results") or []
                    sources = [
                        {
                            "rank": i + 1,
                            "id": h.get("url") or f"web-{i}",
                            "score": 1,
                            "text": (h.get("text") or "")[:350],
                            "url": h.get("url"),
                            "title": h.get("title"),
                        }
                        for i, h in enumerate(hits)
                    ]
                    ctx = "\n\n".join(
                        f"[{s['rank']}] {s.get('title')}\n{s.get('url')}\n{s.get('text')}"
                        for s in sources
                    )
                    answer = await chat_completion(
                        [
                            {
                                "role": "system",
                                "content": "Answer from web results. Cite [n].",
                            },
                            {
                                "role": "user",
                                "content": f"Q: {web_query}\n\nResults:\n{ctx}",
                            },
                        ]
                    )
                    assistant_text = answer
                    yield _sse({"type": "delta", "content": assistant_text})
                else:
                    assistant_text = (
                        "EXA_API_KEY not set on FastAPI backend. "
                        "Configure it or use the Node backend for full /web agent."
                    )
                    yield _sse({"type": "delta", "content": assistant_text})

            elif agent_mode:
                yield _sse(
                    {
                        "type": "status",
                        "message": "Starting multi-hop memory agent…",
                        "mode": "agent",
                    }
                )
                queue: asyncio.Queue[dict | None] = asyncio.Queue()

                async def on_event(ev: dict):
                    await queue.put(ev)

                task = asyncio.create_task(
                    run_memory_agent(
                        agent_query,
                        user_id,
                        modality=body.modality,
                        on_event=on_event,
                    )
                )
                while not task.done():
                    try:
                        ev = await asyncio.wait_for(queue.get(), timeout=0.2)
                    except asyncio.TimeoutError:
                        continue
                    if ev:
                        yield _sse(
                            {
                                "type": "status",
                                "message": ev.get("title") or "Working…",
                                "mode": "agent",
                            }
                        )
                        yield _sse({"type": "agent_step", **ev})
                while not queue.empty():
                    ev = await queue.get()
                    if ev:
                        yield _sse(
                            {
                                "type": "status",
                                "message": ev.get("title") or "Working…",
                                "mode": "agent",
                            }
                        )
                        yield _sse({"type": "agent_step", **ev})
                result = await task
                assistant_text = result["answer"]
                sources = await grounded_sources(user_id, result["chunks"])
                yield _sse(
                    {
                        "type": "meta",
                        "chatId": chat_id,
                        "title": title,
                        "isNewSession": is_new,
                        "mode": "agent",
                        "userMessage": {
                            "id": str(user_msg["id"]),
                            "role": "user",
                            "content": message,
                            "createdAt": user_msg["createdAt"].isoformat(),
                        },
                        "sources": sources,
                    }
                )
                yield _sse({"type": "delta", "content": assistant_text})

            else:
                yield _sse(
                    {
                        "type": "status",
                        "message": "Searching memory and generating a reply…",
                        "mode": "memory",
                    }
                )
                fused = await hybrid_retrieve(
                    user_id, message, limit=50, modality=body.modality
                )
                ranked = await cross_encode_rerank(
                    message,
                    [
                        {"id": c["id"], "text": c["text"], "score": c["score"]}
                        for c in fused
                    ],
                    RERANK_TOP_K,
                )
                by_id = {c["id"]: c for c in fused}
                top = [
                    {**by_id.get(r["id"], r), "score": r["score"], "text": r["text"]}
                    for r in ranked
                ]
                sources = await grounded_sources(user_id, top)
                yield _sse(
                    {
                        "type": "meta",
                        "chatId": chat_id,
                        "title": title,
                        "isNewSession": is_new,
                        "mode": "memory",
                        "userMessage": {
                            "id": str(user_msg["id"]),
                            "role": "user",
                            "content": message,
                            "createdAt": user_msg["createdAt"].isoformat(),
                        },
                        "sources": sources,
                    }
                )

                pool2 = await get_pool()
                async with pool2.acquire() as conn:
                    history = await conn.fetch(
                        """
                        SELECT role, content FROM "Message"
                        WHERE "chatId" = $1
                        ORDER BY "createdAt" DESC LIMIT 20
                        """,
                        chat_id,
                    )
                history = list(reversed([dict(h) for h in history]))
                system = await build_system_prompt(
                    user_id,
                    chat_id,
                    top,
                    project_prompt,
                    body.userAgent,
                )
                llm_messages = [{"role": "system", "content": system}] + [
                    {
                        "role": "assistant" if h["role"] == "assistant" else "user",
                        "content": h["content"],
                    }
                    for h in history
                ]
                settings = get_settings()
                body_or = {
                    "model": settings.chat_model,
                    "messages": llm_messages,
                    "stream": True,
                }
                headers = {
                    "Authorization": f"Bearer {settings.openrouter_api_key}",
                    "Content-Type": "application/json",
                }
                async for delta in _stream(body_or, headers):
                    assistant_text += delta
                    yield _sse({"type": "delta", "content": delta})

            if not assistant_text.strip():
                assistant_text = "I couldn't generate a response. Please try again."
                yield _sse({"type": "delta", "content": assistant_text})

            pool3 = await get_pool()
            async with pool3.acquire() as conn:
                asst = await conn.fetchrow(
                    """
                    INSERT INTO "Message" (id, role, content, "sourceChunks", "chatId", "createdAt")
                    VALUES ($1,'assistant',$2,$3::jsonb,$4,NOW()) RETURNING *
                    """,
                    str(uuid.uuid4()),
                    assistant_text,
                    json.dumps(sources),
                    chat_id,
                )
                if should_set_title:
                    await conn.execute(
                        'UPDATE "Chat" SET title = $2, "updatedAt" = NOW() WHERE id = $1',
                        chat_id,
                        title,
                    )
                else:
                    await conn.execute(
                        'UPDATE "Chat" SET "updatedAt" = NOW() WHERE id = $1', chat_id
                    )

            yield _sse(
                {
                    "type": "done",
                    "chatId": chat_id,
                    "title": title,
                    "isNewSession": is_new,
                    "mode": mode,
                    "userMessage": {
                        "id": str(user_msg["id"]),
                        "role": "user",
                        "content": message,
                        "createdAt": user_msg["createdAt"].isoformat(),
                    },
                    "assistantMessage": {
                        "id": str(asst["id"]),
                        "role": "assistant",
                        "content": assistant_text,
                        "createdAt": asst["createdAt"].isoformat(),
                    },
                    "sources": sources,
                }
            )

            asyncio.create_task(
                extract_and_store_memories(
                    user_id, chat_id, message, assistant_text
                )
            )
        except Exception as e:
            yield _sse({"type": "error", "message": str(e)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
