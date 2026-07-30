from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.auth import resolve_user_id
from app.db import get_pool
from app.services.hybrid_retrieve import hybrid_retrieve
from app.services.search import aggregate_by_document, confidence_from_scores

router = APIRouter(prefix="/api/v1/search", tags=["search"])


class SearchBody(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    limit: int = Field(default=10, ge=1, le=50)
    offset: int = Field(default=0, ge=0)
    modality: str | None = None


@router.post("/")
async def search(body: SearchBody, user_id: str = Depends(resolve_user_id)):
    chunks = await hybrid_retrieve(
        user_id, body.query.strip(), limit=150, modality=body.modality
    )
    aggregated = aggregate_by_document(chunks)
    page = aggregated[body.offset : body.offset + body.limit]
    has_more = body.offset + body.limit < len(aggregated)
    max_score = aggregated[0]["score"] if aggregated else 0

    ids = [a["documentId"] for a in page]
    docs = []
    if ids:
        pool = await get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, title, "ObjectKey", modality, "mimeType", tags, status, "createdAt"
                FROM "Document"
                WHERE "userId" = $1 AND id = ANY($2::text[])
                """,
                user_id,
                ids,
            )
        docs = {str(r["id"]): dict(r) for r in rows}

    documents = []
    for agg in page:
        doc = docs.get(agg["documentId"])
        if not doc:
            continue
        documents.append(
            {
                "id": doc["id"],
                "title": doc["title"],
                "ObjectKey": doc["ObjectKey"],
                "modality": doc["modality"],
                "mimeType": doc["mimeType"],
                "tags": list(doc["tags"] or []),
                "status": doc["status"],
                "createdAt": doc["createdAt"].isoformat() if doc["createdAt"] else None,
                "score": agg["score"],
                "confidence": confidence_from_scores(agg["score"], max_score),
                "snippet": agg["snippet"],
                "preview": agg["preview"],
                "chunkId": agg["chunkId"],
            }
        )

    return {
        "documents": documents,
        "offset": body.offset,
        "limit": body.limit,
        "hasMore": has_more,
        "nextOffset": body.offset + body.limit if has_more else None,
        "totalMatched": len(aggregated),
    }
