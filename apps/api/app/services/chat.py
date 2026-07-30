from __future__ import annotations

import re
from typing import Any

from app.db import get_pool
from app.services.citations import CITATION_ADDENDUM
from app.services.memory import format_memories_block, get_memories_for_prompt, touch_memories
from app.services.openrouter import chat_completion


def title_from_message(message: str) -> str:
    trimmed = re.sub(r"\s+", " ", message.strip())
    return trimmed if len(trimmed) <= 48 else trimmed[:48] + "…"


def is_web_command(message: str) -> bool:
    return bool(re.match(r"^/web(\s|$)", message.lstrip(), re.I))


def strip_web_prefix(message: str) -> str:
    return re.sub(r"^/web\s*", "", message, flags=re.I).strip()


def is_agent_command(message: str) -> bool:
    return bool(re.match(r"^/agent(\s|$)", message.lstrip(), re.I))


def strip_agent_prefix(message: str) -> str:
    return re.sub(r"^/agent\s*", "", message, flags=re.I).strip()


async def build_system_prompt(
    user_id: str,
    chat_id: str,
    context_chunks: list[dict[str, Any]],
    project_system_prompt: str | None = None,
    user_agent: str | None = None,
) -> str:
    parts = []
    for i, c in enumerate(context_chunks):
        meta = []
        if c.get("documentTitle"):
            meta.append(f"doc={c['documentTitle']}")
        if c.get("modality"):
            meta.append(f"modality={c['modality']}")
        if c.get("page") is not None:
            meta.append(f"page={c['page']}")
        if c.get("timestampStart") is not None:
            te = c.get("timestampEnd")
            meta.append(
                f"time={c['timestampStart']}{f'-{te}' if te is not None else ''}s"
            )
        meta_s = f"; {', '.join(meta)}" if meta else ""
        parts.append(f"[{i+1}] (id: {c['id']}{meta_s})\n{c.get('text','')}")
    context = "\n\n---\n\n".join(parts)

    project_block = (
        f"\n\nAdditional project instructions:\n{project_system_prompt.strip()}\n"
        if project_system_prompt and project_system_prompt.strip()
        else ""
    )
    device_block = (
        f"\n\nClient device / browser:\n{user_agent.strip()}\n"
        if user_agent and user_agent.strip()
        else ""
    )

    memories = await get_memories_for_prompt(user_id)
    if memories:
        await touch_memories([str(m["id"]) for m in memories])
    memory_block = format_memories_block(memories)

    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT summary FROM "Chat"
            WHERE "userId" = $1 AND id <> $2 AND summary IS NOT NULL
            ORDER BY "updatedAt" DESC LIMIT 3
            """,
            user_id,
            chat_id,
        )
    final_summary = "\n".join(r["summary"] for r in rows if r["summary"]) or "None"

    return f"""You are RecallOS, an assistant that answers questions using the user's organizational knowledge base.
Use ONLY the context chunks below to answer. If the context is insufficient, say so clearly.
Be concise and accurate.
{CITATION_ADDENDUM}

Recent conversation summaries:
{final_summary}
{memory_block}
{project_block}{device_block}

Context chunks:
{context or "(No relevant chunks found.)"}"""


async def summarize_chat(
    current_summary: str | None, messages: list[dict], is_first: bool
) -> str:
    history = "\n".join(
        f"role: {m['role']}\n\ncontent: {m['content']}\n" for m in messages
    )
    if is_first:
        prompt = f"""Summarize this conversation for future AI context. Max 300 words. Third person.
Conversation:
{history}"""
    else:
        prompt = f"""Summarize this section (max 150 words):
{history}"""
    summary = await chat_completion([{"role": "user", "content": prompt}])
    if not is_first:
        merge = f"""Merge into one coherent summary (max 300 words).
previous:
{current_summary}

latest:
{summary}"""
        return await chat_completion([{"role": "user", "content": merge}])
    return summary
