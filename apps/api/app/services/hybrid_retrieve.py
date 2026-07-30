from __future__ import annotations

import logging
import re
from typing import Any

from qdrant_client import QdrantClient
from qdrant_client.http import models as qm

from app.config import get_settings
from app.db import get_pool
from app.services.embed import get_dense_vectors, get_sparse_vectors

logger = logging.getLogger("recallos.retrieve")

TAG_MATCH_BOOST_PER_TAG = 0.04
TAG_MATCH_BOOST_CAP = 0.12


def _tag_match_boost(query: str, tags: list[str] | None) -> float:
    if not tags:
        return 0.0
    q = query.lower().strip()
    if not q:
        return 0.0
    query_tokens = set(t for t in re.split(r"[^a-z0-9]+", q) if len(t) >= 2)
    boost = 0.0
    for raw in tags:
        tag = raw.strip().lower()
        if not tag:
            continue
        if tag in q:
            boost += TAG_MATCH_BOOST_PER_TAG
            continue
        tag_tokens = [t for t in re.split(r"[^a-z0-9]+", tag) if len(t) >= 2]
        if tag_tokens and all(tt in query_tokens for tt in tag_tokens):
            boost += TAG_MATCH_BOOST_PER_TAG * 0.75
            continue
        if len(tag_tokens) == 1 and tag_tokens[0] in query_tokens:
            boost += TAG_MATCH_BOOST_PER_TAG
    return min(boost, TAG_MATCH_BOOST_CAP)


def _qdrant() -> QdrantClient:
    s = get_settings()
    return QdrantClient(host=s.qdrant_host, port=s.qdrant_port)


async def hybrid_retrieve(
    user_id: str,
    query: str,
    *,
    limit: int = 50,
    modality: str | None = None,
) -> list[dict[str, Any]]:
    settings = get_settings()
    limit = max(1, min(limit, 200))

    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            'SELECT id FROM "Document" WHERE "userId" = $1', user_id
        )
    owned = [str(r["id"]) for r in rows]
    if not owned:
        return []

    dense = get_dense_vectors([query])[0]
    sparse = get_sparse_vectors([query])[0]
    if not sparse["indices"]:
        raise RuntimeError("Sparse vector is empty")

    must: list[qm.FieldCondition] = [
        qm.FieldCondition(key="documentId", match=qm.MatchAny(any=owned))
    ]
    if modality:
        must.append(
            qm.FieldCondition(key="modality", match=qm.MatchValue(value=modality))
        )
    filt = qm.Filter(must=must)

    client = _qdrant()
    res = client.query_points(
        collection_name=settings.collection,
        prefetch=[
            qm.Prefetch(
                query=dense,
                using="dense",
                limit=limit,
                filter=filt,
            ),
            qm.Prefetch(
                query=qm.SparseVector(
                    indices=sparse["indices"], values=sparse["values"]
                ),
                using="splade",
                limit=limit,
                filter=filt,
            ),
        ],
        query=qm.FusionQuery(fusion=qm.Fusion.RRF),
        limit=limit,
        query_filter=filt,
        with_payload=True,
    )

    owned_set = set(owned)
    chunks: list[dict[str, Any]] = []
    for point in res.points or []:
        payload = point.payload or {}
        text = payload.get("text") or ""
        if not text:
            continue
        doc_id = payload.get("documentId")
        doc_id_s = str(doc_id) if doc_id is not None else None
        if not doc_id_s or doc_id_s not in owned_set:
            continue
        payload_uid = payload.get("userId")
        if payload_uid is not None and str(payload_uid) != user_id:
            continue
        tags = payload.get("tags")
        tags_list = [t for t in tags if isinstance(t, str)] if isinstance(tags, list) else []
        score = float(point.score or 0) + _tag_match_boost(query, tags_list)
        chunks.append(
            {
                "id": str(point.id),
                "text": text,
                "score": score,
                "documentId": doc_id_s,
                "documentTitle": payload.get("documentTitle"),
                "tags": tags_list,
                "modality": payload.get("modality"),
                "page": payload.get("page"),
                "timestampStart": payload.get("timestampStart"),
                "timestampEnd": payload.get("timestampEnd"),
                "caption": payload.get("caption"),
                "chunkId": payload.get("chunkId"),
            }
        )
    chunks.sort(key=lambda c: c["score"], reverse=True)
    return chunks
