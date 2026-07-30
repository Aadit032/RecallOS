from __future__ import annotations

from typing import Any


SNIPPET_MAX = 320
PREVIEW_MAX = 900


def snippet_from_chunk(text: str, max_len: int = SNIPPET_MAX) -> str:
    body = text
    sep = "\n---\n"
    idx = text.find(sep)
    if idx != -1 and text.startswith("Document:"):
        body = text[idx + len(sep) :]
    collapsed = " ".join(body.split()).strip()
    if len(collapsed) <= max_len:
        return collapsed
    return collapsed[:max_len] + "…"


def confidence_from_scores(score: float, max_score: float) -> int:
    if not score or score <= 0:
        return 0
    if not max_score or max_score <= 0:
        return max(1, min(99, round(score * 100)))
    ratio = max(0.0, min(1.0, score / max_score))
    curved = ratio**0.85
    return max(1, min(99, round(curved * 100)))


def aggregate_by_document(chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    best: dict[str, dict[str, Any]] = {}
    for chunk in chunks:
        doc_id = chunk.get("documentId")
        if not doc_id:
            continue
        doc_id = str(doc_id)
        existing = best.get(doc_id)
        if not existing or chunk["score"] > existing["score"]:
            best[doc_id] = {
                "documentId": doc_id,
                "score": chunk["score"],
                "snippet": snippet_from_chunk(chunk["text"], SNIPPET_MAX) or None,
                "preview": snippet_from_chunk(chunk["text"], PREVIEW_MAX) or None,
                "chunkId": chunk.get("id"),
                "bestChunk": chunk,
            }
    return sorted(best.values(), key=lambda a: a["score"], reverse=True)
