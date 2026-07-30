from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from app.db import get_pool
from app.services.openrouter import chat_completion

logger = logging.getLogger("recallos.memory")


async def get_memories_for_prompt(user_id: str, limit: int = 12) -> list[dict[str, Any]]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, fact, importance, source, "chatId", "createdAt", "updatedAt", "lastUsedAt"
            FROM "Memory"
            WHERE "userId" = $1
            ORDER BY importance DESC NULLS LAST, "lastUsedAt" DESC NULLS LAST, "updatedAt" DESC
            LIMIT $2
            """,
            user_id,
            limit,
        )
    return [dict(r) for r in rows]


def format_memories_block(memories: list[dict[str, Any]]) -> str:
    if not memories:
        return ""
    lines = [
        f"{i+1}. (importance {m.get('importance') or 5}/10) {m['fact']}"
        for i, m in enumerate(memories)
    ]
    return (
        "\n\nLong-term user memories (durable facts; prefer these over guesses):\n"
        + "\n".join(lines)
        + "\n"
    )


async def touch_memories(ids: list[str]) -> None:
    if not ids:
        return
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            'UPDATE "Memory" SET "lastUsedAt" = NOW() WHERE id = ANY($1::text[])',
            ids,
        )


async def list_memories(user_id: str, limit: int = 50) -> list[dict[str, Any]]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT * FROM "Memory"
            WHERE "userId" = $1
            ORDER BY importance DESC NULLS LAST, "updatedAt" DESC
            LIMIT $2
            """,
            user_id,
            min(limit, 100),
        )
    return [dict(r) for r in rows]


async def create_memory(user_id: str, fact: str, importance: int = 5) -> dict[str, Any]:
    mid = str(uuid.uuid4())
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO "Memory" (id, fact, importance, source, "userId", "createdAt", "updatedAt")
            VALUES ($1, $2, $3, 'manual', $4, NOW(), NOW())
            RETURNING *
            """,
            mid,
            fact.strip()[:500],
            max(1, min(10, importance)),
            user_id,
        )
    return dict(row)


async def delete_memory(user_id: str, mid: str) -> bool:
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            'DELETE FROM "Memory" WHERE id = $1 AND "userId" = $2', mid, user_id
        )
    return result.endswith("1")


async def extract_and_store_memories(
    user_id: str, chat_id: str, user_message: str, assistant_message: str
) -> int:
    existing = await list_memories(user_id, 40)
    existing_block = (
        "(none yet)"
        if not existing
        else "\n".join(f"{i+1}. {m['fact']}" for i, m in enumerate(existing))
    )
    prompt = f"""You extract durable long-term memories about the USER.
Return ONLY valid JSON: {{"memories":[{{"fact":"...","importance":1-10}}]}}
Rules: max 3; skip ephemeral Q&A; skip if nothing durable.
Existing:
{existing_block}
User:
{user_message[:1500]}
Assistant:
{assistant_message[:1200]}
"""
    try:
        raw = await chat_completion(
            [{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
        )
        parsed = json.loads(raw if isinstance(raw, str) else str(raw))
        candidates = parsed.get("memories") or []
        existing_lower = {m["fact"].lower().strip() for m in existing}
        stored = 0
        pool = await get_pool()
        async with pool.acquire() as conn:
            for c in candidates[:3]:
                fact = str(c.get("fact") or "").strip()[:500]
                if len(fact) < 8 or fact.lower() in existing_lower:
                    continue
                importance = max(1, min(10, int(c.get("importance") or 5)))
                await conn.execute(
                    """
                    INSERT INTO "Memory" (id, fact, importance, source, "chatId", "userId", "createdAt", "updatedAt")
                    VALUES ($1, $2, $3, 'chat', $4, $5, NOW(), NOW())
                    """,
                    str(uuid.uuid4()),
                    fact,
                    importance,
                    chat_id,
                    user_id,
                )
                existing_lower.add(fact.lower())
                stored += 1
        return stored
    except Exception as e:
        logger.error("memory extract failed: %s", e)
        return 0
