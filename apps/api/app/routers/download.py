from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from qdrant_client import QdrantClient
from qdrant_client.http import models as qm

from app.auth import resolve_user_id
from app.config import get_settings
from app.db import get_pool
from app.services.storage import delete_object, presigned_get

router = APIRouter(prefix="/api/v1/download", tags=["download"])


class DownloadBody(BaseModel):
    key: str


@router.post("/get-download-url")
async def get_download_url(body: DownloadBody, user_id: str = Depends(resolve_user_id)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        doc = await conn.fetchrow(
            'SELECT id FROM "Document" WHERE "ObjectKey" = $1 AND "userId" = $2',
            body.key,
            user_id,
        )
    if not doc:
        raise HTTPException(status_code=403, detail={"message": "Forbidden."})
    return {"presignedUrl": presigned_get(body.key)}


@router.get("/list")
async def list_docs(
    user_id: str = Depends(resolve_user_id),
    limit: int = Query(default=10, ge=1, le=50),
    cursor: str | None = None,
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        if cursor:
            rows = await conn.fetch(
                """
                SELECT id, title, status, "ObjectKey", modality, tags, "createdAt", "updatedAt"
                FROM "Document"
                WHERE "userId" = $1 AND "createdAt" <= (
                  SELECT "createdAt" FROM "Document" WHERE id = $2
                ) AND id <> $2
                ORDER BY "createdAt" DESC
                LIMIT $3
                """,
                user_id,
                cursor,
                limit + 1,
            )
            # simpler cursor by id position — use createdAt desc with skip via not-in page
            rows = await conn.fetch(
                """
                SELECT id, title, status, "ObjectKey", modality, tags, "createdAt", "updatedAt"
                FROM "Document"
                WHERE "userId" = $1
                ORDER BY "createdAt" DESC
                LIMIT $2
                """,
                user_id,
                500,
            )
            # paginate in python for cursor simplicity
            ids = [str(r["id"]) for r in rows]
            if cursor in ids:
                start = ids.index(cursor) + 1
                rows = rows[start : start + limit + 1]
            else:
                rows = rows[: limit + 1]
        else:
            rows = await conn.fetch(
                """
                SELECT id, title, status, "ObjectKey", modality, tags, "createdAt", "updatedAt"
                FROM "Document"
                WHERE "userId" = $1
                ORDER BY "createdAt" DESC
                LIMIT $2
                """,
                user_id,
                limit + 1,
            )

    has_more = len(rows) > limit
    page = rows[:limit] if has_more else rows
    next_cursor = str(page[-1]["id"]) if has_more and page else None
    docs = []
    for r in page:
        d = dict(r)
        d["createdAt"] = d["createdAt"].isoformat() if d.get("createdAt") else None
        d["updatedAt"] = d["updatedAt"].isoformat() if d.get("updatedAt") else None
        d["tags"] = list(d.get("tags") or [])
        docs.append(d)
    return {"documents": docs, "nextCursor": next_cursor}


@router.delete("/{doc_id}")
async def delete_doc(doc_id: str, user_id: str = Depends(resolve_user_id)):
    settings = get_settings()
    pool = await get_pool()
    async with pool.acquire() as conn:
        doc = await conn.fetchrow(
            'SELECT * FROM "Document" WHERE id = $1 AND "userId" = $2',
            doc_id,
            user_id,
        )
        if not doc:
            raise HTTPException(status_code=404, detail={"message": "Document not found"})
        try:
            delete_object(doc["ObjectKey"])
        except Exception:
            pass
        try:
            client = QdrantClient(host=settings.qdrant_host, port=settings.qdrant_port)
            client.delete(
                collection_name=settings.collection,
                points_selector=qm.FilterSelector(
                    filter=qm.Filter(
                        must=[
                            qm.FieldCondition(
                                key="documentId",
                                match=qm.MatchValue(value=doc_id),
                            )
                        ]
                    )
                ),
            )
        except Exception:
            pass
        await conn.execute('DELETE FROM "Document" WHERE id = $1', doc_id)
    return {"message": "Document deleted"}
