from __future__ import annotations

from typing import Any

from app.db import get_pool


async def grounded_sources(
    user_id: str, chunks: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    doc_ids = list(
        {
            str(c["documentId"])
            for c in chunks
            if c.get("documentId") is not None
        }
    )
    by_id: dict[str, dict] = {}
    if doc_ids:
        pool = await get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, title, "ObjectKey", modality, "mimeType"
                FROM "Document"
                WHERE "userId" = $1 AND id = ANY($2::text[])
                """,
                user_id,
                doc_ids,
            )
        by_id = {str(r["id"]): dict(r) for r in rows}

    out: list[dict[str, Any]] = []
    for i, c in enumerate(chunks):
        doc_id = str(c["documentId"]) if c.get("documentId") is not None else None
        doc = by_id.get(doc_id or "")
        out.append(
            {
                "rank": i + 1,
                "id": c["id"],
                "score": c.get("score") or 0,
                "text": (c.get("text") or "")[:450],
                "documentId": doc_id,
                "title": (doc or {}).get("title") or c.get("documentTitle"),
                "modality": c.get("modality") or (doc or {}).get("modality"),
                "page": c.get("page"),
                "timestampStart": c.get("timestampStart"),
                "timestampEnd": c.get("timestampEnd"),
                "caption": c.get("caption"),
                "objectKey": (doc or {}).get("ObjectKey"),
                "mimeType": (doc or {}).get("mimeType"),
            }
        )
    return out


CITATION_ADDENDUM = """
When you cite context chunks, use [n] matching the chunk rank.
If a chunk includes page numbers, reference them (e.g. [1] p.4).
If a chunk includes timestamps (audio/video), reference them (e.g. [2] at 1:12).
Prefer grounded claims over general knowledge.
"""
