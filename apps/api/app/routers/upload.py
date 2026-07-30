from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import resolve_user_id
from app.config import get_settings
from app.db import get_pool
from app.services.storage import head_object, presigned_put, xadd_stream

router = APIRouter(prefix="/api/v1/upload", tags=["upload"])


def key_prefix(mime: str) -> str:
    if mime.startswith("image/"):
        return "image"
    if mime.startswith("audio/"):
        return "audio"
    if mime.startswith("video/"):
        return "video"
    return "pdf"


def modality_from_mime(mime: str) -> str:
    return key_prefix(mime)


def normalize_tags(raw) -> list[str]:
    if not isinstance(raw, list):
        return []
    seen, out = set(), []
    for item in raw:
        if not isinstance(item, str):
            continue
        tag = item.strip()[:40]
        if not tag:
            continue
        k = tag.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(tag)
        if len(out) >= 20:
            break
    return out


class PresignBody(BaseModel):
    fileName: str
    contentType: str


class ConfirmBody(BaseModel):
    fileName: str
    key: str
    size: int | str
    contentType: str | None = None
    tags: list | None = None


@router.post("/post-file-url")
async def post_file_url(body: PresignBody, user_id: str = Depends(resolve_user_id)):
    safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in body.fileName)
    key = f"{key_prefix(body.contentType)}/{safe}-{uuid.uuid4()}"
    url = presigned_put(key, body.contentType)
    return {"presignedUrl": url, "key": key}


@router.post("/confirm")
async def confirm(body: ConfirmBody, user_id: str = Depends(resolve_user_id)):
    settings = get_settings()
    mime = body.contentType or "application/pdf"
    tags = normalize_tags(body.tags)
    try:
        head = head_object(body.key)
    except Exception as e:
        raise HTTPException(status_code=500, detail={"message": f"Head failed: {e}"})
    if int(head.get("ContentLength") or 0) != int(body.size):
        raise HTTPException(
            status_code=403,
            detail={"message": "The file has not been uploaded correctly."},
        )

    pool = await get_pool()
    doc_id = str(uuid.uuid4())
    async with pool.acquire() as conn:
        existing = await conn.fetchrow(
            'SELECT id FROM "Document" WHERE "ObjectKey" = $1', body.key
        )
        if existing:
            return {
                "message": "Server confirmed the upload!!",
                "documentId": str(existing["id"]),
            }
        await conn.execute(
            """
            INSERT INTO "Document"
              (id, title, "mimeType", modality, "ObjectKey", status, tags, "userId", "createdAt", "updatedAt")
            VALUES ($1,$2,$3,$4,$5,'UPLOADED',$6,$7,NOW(),NOW())
            """,
            doc_id,
            body.fileName,
            mime,
            modality_from_mime(mime),
            body.key,
            tags,
            user_id,
        )
    msg_id = await xadd_stream(settings.files_stream, {"docId": doc_id})
    if not msg_id:
        raise HTTPException(
            status_code=500, detail={"message": "The file was not pushed on the queue."}
        )
    async with pool.acquire() as conn:
        await conn.execute(
            'UPDATE "Document" SET "streamMessageId" = $2 WHERE id = $1',
            doc_id,
            msg_id,
        )
    return {"message": "Server confirmed the upload!!", "documentId": doc_id}
