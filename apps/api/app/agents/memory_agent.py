"""Multi-hop agentic RAG over document memory (plan → retrieve → reason → answer)."""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Awaitable, Callable

from app.services.embed import cross_encode_rerank
from app.services.hybrid_retrieve import hybrid_retrieve
from app.services.openrouter import chat_completion

logger = logging.getLogger("recallos.memory_agent")

MAX_HOPS = 4
CHUNKS_PER_HOP = 8
FINAL_TOP_K = 8

ProgressCb = Callable[[dict[str, Any]], Awaitable[None] | None]


def _format_chunks(chunks: list[dict[str, Any]]) -> str:
    if not chunks:
        return "(no chunks yet)"
    lines = []
    for i, c in enumerate(chunks[:20]):
        meta = []
        if c.get("documentTitle"):
            meta.append(f"title={c['documentTitle']}")
        if c.get("modality"):
            meta.append(f"modality={c['modality']}")
        if c.get("page") is not None:
            meta.append(f"page={c['page']}")
        if c.get("timestampStart") is not None:
            meta.append(f"t={c['timestampStart']}")
        meta_s = f" ({', '.join(meta)})" if meta else ""
        lines.append(
            f"[{i+1}] id={c['id']} score={float(c.get('score') or 0):.3f}{meta_s}\n{(c.get('text') or '')[:600]}"
        )
    return "\n\n---\n\n".join(lines)


def _parse_json(raw: str) -> dict:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", raw)
        if m:
            return json.loads(m.group(0))
        return {}


async def run_memory_agent(
    query: str,
    user_id: str,
    *,
    modality: str | None = None,
    on_event: ProgressCb | None = None,
) -> dict[str, Any]:
    async def emit(event: dict[str, Any]) -> None:
        if on_event:
            maybe = on_event(event)
            if maybe is not None:
                await maybe

    await emit(
        {
            "step": "start",
            "title": "Starting multi-hop memory agent…",
            "query": query,
        }
    )

    plan_raw = await chat_completion(
        [
            {
                "role": "system",
                "content": "Plan multi-hop retrieval. Return JSON: "
                '{"enoughInformation":false,"nextSearchQuery":"...","reasoning":"...","subQueries":["..."]}',
            },
            {"role": "user", "content": f"Question: {query}"},
        ],
        response_format={"type": "json_object"},
    )
    plan = _parse_json(plan_raw if isinstance(plan_raw, str) else str(plan_raw))
    queries = []
    nsq = (plan.get("nextSearchQuery") or query).strip()
    if nsq:
        queries.append(nsq)
    for sq in plan.get("subQueries") or []:
        s = str(sq).strip()
        if s and s not in queries:
            queries.append(s)
    if not queries:
        queries = [query]

    await emit(
        {
            "step": "plan",
            "title": "Planned retrieval hops",
            "detail": " · ".join(queries[:3]),
            "query": queries[0],
            "reasoning": plan.get("reasoning"),
        }
    )

    accumulated: dict[str, dict[str, Any]] = {}
    next_q = queries[0]
    hops = 0
    decision: dict[str, Any] = {}

    while hops < MAX_HOPS:
        hops += 1
        raw = await hybrid_retrieve(user_id, next_q, limit=40, modality=modality)
        ranked = await cross_encode_rerank(
            next_q,
            [{"id": c["id"], "text": c["text"], "score": c["score"]} for c in raw],
            CHUNKS_PER_HOP,
        )
        by_id = {c["id"]: c for c in raw}
        for r in ranked:
            base = by_id.get(r["id"], r)
            merged = {**base, "score": r["score"], "text": r.get("text") or base.get("text")}
            prev = accumulated.get(merged["id"])
            if not prev or merged["score"] > prev["score"]:
                accumulated[merged["id"]] = merged

        await emit(
            {
                "step": "retrieve",
                "title": f"Retrieved hop {hops}",
                "resultCount": len(ranked),
                "iteration": hops,
                "query": next_q,
            }
        )

        chunks = sorted(accumulated.values(), key=lambda c: c["score"], reverse=True)
        reason_raw = await chat_completion(
            [
                {
                    "role": "system",
                    "content": "Retrieval critic. Return JSON: "
                    '{"enoughInformation":bool,"nextSearchQuery":"...","reasoning":"...","subQueries":[]}',
                },
                {
                    "role": "user",
                    "content": f"Original: {query}\nHop: {hops}/{MAX_HOPS}\nChunks:\n{_format_chunks(chunks)}",
                },
            ],
            response_format={"type": "json_object"},
        )
        decision = _parse_json(
            reason_raw if isinstance(reason_raw, str) else str(reason_raw)
        )
        await emit(
            {
                "step": "reason",
                "title": (
                    "Evidence sufficient"
                    if decision.get("enoughInformation")
                    else "Need another hop"
                ),
                "enough": decision.get("enoughInformation"),
                "reasoning": decision.get("reasoning"),
                "nextQuery": decision.get("nextSearchQuery"),
                "iteration": hops,
            }
        )
        if decision.get("enoughInformation"):
            break
        nsq = (decision.get("nextSearchQuery") or "").strip()
        if not nsq:
            break
        next_q = nsq

    top = sorted(accumulated.values(), key=lambda c: c["score"], reverse=True)[
        :FINAL_TOP_K
    ]
    await emit({"step": "answer", "title": "Composing grounded answer…"})
    answer = await chat_completion(
        [
            {
                "role": "system",
                "content": "You are RecallOS. Answer using ONLY provided chunks. "
                "Cite as [n]. Mention page/timestamp when present.",
            },
            {
                "role": "user",
                "content": f"Question: {query}\n\nChunks:\n{_format_chunks(top)}",
            },
        ]
    )
    await emit(
        {
            "step": "done",
            "title": "Multi-hop research complete",
            "resultCount": len(top),
            "iteration": hops,
        }
    )
    return {
        "answer": answer
        or "I couldn't find enough information in your library.",
        "chunks": top,
        "hops": hops,
    }
