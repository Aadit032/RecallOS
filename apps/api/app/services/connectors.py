from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any

import httpx

from app.config import get_settings
from app.db import get_pool
from app.services.storage import put_object, xadd_stream

logger = logging.getLogger("recallos.connectors")


def _chunk_text(text: str, size: int = 1200, overlap: int = 150) -> list[str]:
    cleaned = text.replace("\r\n", "\n").strip()
    if not cleaned:
        return []
    if len(cleaned) <= size:
        return [cleaned]
    chunks: list[str] = []
    i = 0
    while i < len(cleaned):
        end = min(len(cleaned), i + size)
        chunks.append(cleaned[i:end])
        if end >= len(cleaned):
            break
        i = max(0, end - overlap)
    return chunks[:40]


async def list_connectors(user_id: str) -> list[dict[str, Any]]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT * FROM "Connector"
            WHERE "userId" = $1
            ORDER BY "updatedAt" DESC
            """,
            user_id,
        )
        out = []
        for r in rows:
            d = dict(r)
            if isinstance(d.get("config"), str):
                try:
                    d["config"] = json.loads(d["config"])
                except json.JSONDecodeError:
                    d["config"] = {}
            jobs = await conn.fetch(
                """
                SELECT * FROM "ConnectorSyncJob"
                WHERE "connectorId" = $1
                ORDER BY "startedAt" DESC LIMIT 3
                """,
                d["id"],
            )
            d["jobs"] = [dict(j) for j in jobs]
            out.append(d)
    return out


async def create_connector(
    user_id: str,
    type_: str,
    name: str,
    config: dict,
    sync_interval: int = 30,
) -> dict[str, Any]:
    cid = str(uuid.uuid4())
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO "Connector"
              (id, type, name, config, status, "syncInterval", "userId", "createdAt", "updatedAt")
            VALUES ($1,$2,$3,$4::jsonb,'ACTIVE',$5,$6,NOW(),NOW())
            RETURNING *
            """,
            cid,
            type_,
            name.strip()[:120],
            json.dumps(config or {}),
            max(5, min(24 * 60, sync_interval)),
            user_id,
        )
    return dict(row)


async def delete_connector(user_id: str, cid: str) -> bool:
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            'DELETE FROM "Connector" WHERE id = $1 AND "userId" = $2', cid, user_id
        )
    return result.endswith("1")


async def set_connector_status(
    user_id: str, cid: str, status: str
) -> dict[str, Any] | None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE "Connector" SET status = $3, "updatedAt" = NOW()
            WHERE id = $1 AND "userId" = $2
            RETURNING *
            """,
            cid,
            user_id,
            status,
        )
    return dict(row) if row else None


async def _ingest_text(
    user_id: str, title: str, text: str, tags: list[str], source_key: str
) -> str | None:
    settings = get_settings()
    key = f"connectors/{user_id}/{source_key}-{uuid.uuid4()}.txt"
    await put_object(key, text.encode("utf-8"), "text/plain")

    doc_id = str(uuid.uuid4())
    chunk_set_id = str(uuid.uuid4())
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO "Document"
              (id, title, content, "mimeType", modality, "ObjectKey", status, tags, "userId", "createdAt", "updatedAt")
            VALUES ($1,$2,$3,'text/plain','pdf',$4,'PARSED',$5,$6,NOW(),NOW())
            """,
            doc_id,
            title[:240],
            text[:50_000],
            key,
            tags,
            user_id,
        )
        await conn.execute(
            """
            INSERT INTO "ParsedChunkSet" (id, modality, status, "createdAt", "documentId")
            VALUES ($1,'pdf','PARSED',NOW(),$2)
            """,
            chunk_set_id,
            doc_id,
        )
        for chunk in _chunk_text(text):
            body = (
                f"Document: {title}\nModality: pdf\nTags: {', '.join(tags)}\n---\n{chunk}"
            )
            await conn.execute(
                """
                INSERT INTO "ParsedChunk" (id, text, metadata, "chunkSetId")
                VALUES ($1,$2,$3::jsonb,$4)
                """,
                str(uuid.uuid4()),
                body,
                json.dumps(
                    {
                        "documentTitle": title,
                        "tags": tags,
                        "modality": "pdf",
                        "source": "connector",
                    }
                ),
                chunk_set_id,
            )
    msg_id = await xadd_stream(settings.embed_stream, {"chunkSetId": chunk_set_id})
    if msg_id:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE "Document"
                SET status = 'EMBEDDING', "streamMessageId" = $2, "updatedAt" = NOW()
                WHERE id = $1
                """,
                doc_id,
                msg_id,
            )
    return doc_id


async def _fetch_url_text(url: str) -> tuple[str, str]:
    async with httpx.AsyncClient(timeout=25.0, follow_redirects=True) as client:
        resp = await client.get(url, headers={"User-Agent": "RecallOS-Connector/1.0"})
        resp.raise_for_status()
        html = resp.text
    title_m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.I)
    title = (title_m.group(1).strip() if title_m else url)
    text = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.I)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()[:80_000]
    return title, text


async def run_connector_sync(connector_id: str) -> dict[str, Any]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        connector = await conn.fetchrow(
            'SELECT * FROM "Connector" WHERE id = $1', connector_id
        )
        if not connector:
            return {"documentsCreated": 0, "error": "Connector not found"}
        job_id = str(uuid.uuid4())
        await conn.execute(
            """
            INSERT INTO "ConnectorSyncJob" (id, status, "documentsCreated", "startedAt", "connectorId")
            VALUES ($1,'RUNNING',0,NOW(),$2)
            """,
            job_id,
            connector_id,
        )

    config = connector["config"]
    if isinstance(config, str):
        config = json.loads(config)
    config = config or {}
    tags = [f"connector:{connector['type']}", f"connector-id:{connector_id}"]
    created = 0
    error: str | None = None

    try:
        type_ = connector["type"]
        user_id = connector["userId"]
        if type_ in ("url", "notion"):
            url = config.get("url")
            if not url:
                raise ValueError("url required")
            title, text = await _fetch_url_text(url)
            if len(text) < 40:
                raise ValueError("Page produced too little text")
            if await _ingest_text(user_id, title, text, tags, "url"):
                created = 1
        elif type_ == "rss":
            feed_url = config.get("feedUrl") or config.get("url")
            if not feed_url:
                raise ValueError("feedUrl required")
            async with httpx.AsyncClient(timeout=25.0) as client:
                resp = await client.get(
                    feed_url, headers={"User-Agent": "RecallOS-Connector/1.0"}
                )
                resp.raise_for_status()
                xml = resp.text
            items = re.findall(r"<item[\s\S]*?</item>", xml, re.I)[
                : int(config.get("maxItems") or 5)
            ]
            if not items:
                items = re.findall(r"<entry[\s\S]*?</entry>", xml, re.I)[
                    : int(config.get("maxItems") or 5)
                ]
            for block in items:
                title_m = re.search(
                    r"<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?</title>",
                    block,
                    re.I,
                )
                title = (title_m.group(1).strip() if title_m else "RSS item")[:240]
                link_m = re.search(r"<link>([^<]+)</link>", block, re.I) or re.search(
                    r'<link[^>]+href="([^"]+)"', block, re.I
                )
                link = link_m.group(1).strip() if link_m else None
                desc_m = re.search(
                    r"<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?</description>",
                    block,
                    re.I,
                )
                text = re.sub(r"<[^>]+>", " ", desc_m.group(1) if desc_m else "")
                text = re.sub(r"\s+", " ", text).strip()
                if link:
                    try:
                        _, page = await _fetch_url_text(link)
                        text = (text + "\n\n" + page)[:80_000]
                    except Exception:
                        pass
                if len(text) < 40:
                    continue
                if await _ingest_text(
                    user_id, title, text, tags + ["rss"], "rss"
                ):
                    created += 1
        elif type_ == "github":
            repo = config.get("repo") or ""
            if "/" not in repo:
                raise ValueError("repo must be owner/name")
            branch = config.get("branch") or "main"
            path = (config.get("path") or "").lstrip("/")
            headers = {
                "Accept": "application/vnd.github+json",
                "User-Agent": "RecallOS-Connector/1.0",
            }
            if config.get("token"):
                headers["Authorization"] = f"Bearer {config['token']}"
            api = (
                f"https://api.github.com/repos/{repo}/contents/{path}?ref={branch}"
                if path
                else f"https://api.github.com/repos/{repo}/contents?ref={branch}"
            )
            async with httpx.AsyncClient(timeout=25.0) as client:
                resp = await client.get(api, headers=headers)
                resp.raise_for_status()
                data = resp.json()
            files = data if isinstance(data, list) else [data]
            text_files = [
                f
                for f in files
                if f.get("type") == "file"
                and re.search(
                    r"\.(md|txt|rst|json|ya?ml|ts|tsx|js|py|go|rs)$",
                    f.get("name") or "",
                    re.I,
                )
            ][: int(config.get("maxItems") or 15)]
            async with httpx.AsyncClient(timeout=20.0) as client:
                for f in text_files:
                    url = f.get("download_url")
                    if not url:
                        continue
                    r = await client.get(
                        url,
                        headers={
                            "Authorization": headers.get("Authorization", "")
                        }
                        if config.get("token")
                        else {},
                    )
                    if r.status_code != 200:
                        continue
                    text = r.text[:80_000]
                    if len(text) < 20:
                        continue
                    if await _ingest_text(
                        user_id,
                        f"{repo}:{f.get('path')}",
                        text,
                        tags + ["github", repo],
                        "github",
                    ):
                        created += 1
        else:
            raise ValueError(f"Unsupported connector type: {type_}")

        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE "ConnectorSyncJob"
                SET status='SUCCESS', "documentsCreated"=$2, "finishedAt"=NOW()
                WHERE id=$1
                """,
                job_id,
                created,
            )
            await conn.execute(
                """
                UPDATE "Connector"
                SET "lastSyncedAt"=NOW(), "lastError"=NULL, status='ACTIVE', "updatedAt"=NOW()
                WHERE id=$1
                """,
                connector_id,
            )
    except Exception as e:
        error = str(e)
        logger.exception("connector sync failed")
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE "ConnectorSyncJob"
                SET status='FAILED', error=$2, "finishedAt"=NOW()
                WHERE id=$1
                """,
                job_id,
                error,
            )
            await conn.execute(
                """
                UPDATE "Connector"
                SET "lastError"=$2, status='ERROR', "updatedAt"=NOW()
                WHERE id=$1
                """,
                connector_id,
                error,
            )

    return {"documentsCreated": created, "error": error}


async def run_due_connector_syncs(limit: int = 10) -> int:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, "syncInterval", "lastSyncedAt"
            FROM "Connector"
            WHERE status = 'ACTIVE'
            ORDER BY "lastSyncedAt" ASC NULLS FIRST
            LIMIT $1
            """,
            limit * 3,
        )
    ran = 0
    import time

    now = time.time()
    for r in rows:
        interval = (r["syncInterval"] or 30) * 60
        last = r["lastSyncedAt"].timestamp() if r["lastSyncedAt"] else 0
        if now - last < interval:
            continue
        await run_connector_sync(str(r["id"]))
        ran += 1
        if ran >= limit:
            break
    return ran
