from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger("recallos.embed")

_dense_model = None
_sparse_model = None


def _get_dense():
    global _dense_model
    if _dense_model is None:
        from fastembed import TextEmbedding

        logger.info("Loading BGE-small-en dense model…")
        _dense_model = TextEmbedding(model_name="BAAI/bge-small-en-v1.5")
    return _dense_model


def _get_sparse():
    global _sparse_model
    if _sparse_model is None:
        from fastembed import SparseTextEmbedding

        logger.info("Loading SPLADE sparse model…")
        _sparse_model = SparseTextEmbedding(model_name="prithivida/Splade_PP_en_v1")
    return _sparse_model


def get_dense_vectors(texts: list[str]) -> list[list[float]]:
    model = _get_dense()
    return [list(map(float, v)) for v in model.embed(texts)]


def get_sparse_vectors(texts: list[str]) -> list[dict[str, list]]:
    model = _get_sparse()
    out: list[dict[str, list]] = []
    for emb in model.embed(texts):
        # SparseEmbedding has indices / values
        indices = list(map(int, emb.indices))
        values = list(map(float, emb.values))
        paired = sorted(
            [(i, v) for i, v in zip(indices, values) if v != 0],
            key=lambda p: p[0],
        )
        out.append(
            {
                "indices": [p[0] for p in paired],
                "values": [p[1] for p in paired],
            }
        )
    return out


async def cross_encode_rerank(
    query: str,
    chunks: list[dict[str, Any]],
    top_k: int = 5,
) -> list[dict[str, Any]]:
    """HF Inference cross-encoder; falls back to input scores."""
    if not chunks:
        return []
    settings = get_settings()
    pairs = [[query, c.get("text", "")[:2000]] for c in chunks]
    try:
        headers = {"Content-Type": "application/json"}
        if settings.hf_token:
            headers["Authorization"] = f"Bearer {settings.hf_token}"
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"https://api-inference.huggingface.co/models/{settings.cross_encoder_model}",
                headers=headers,
                json={"inputs": pairs},
            )
            if resp.status_code != 200:
                raise RuntimeError(f"HF {resp.status_code}: {resp.text[:200]}")
            scores = resp.json()
            # scores may be list of floats or list of dicts
            flat: list[float] = []
            if isinstance(scores, list):
                for s in scores:
                    if isinstance(s, (int, float)):
                        flat.append(float(s))
                    elif isinstance(s, dict) and "score" in s:
                        flat.append(float(s["score"]))
                    else:
                        flat.append(0.0)
            ranked = []
            for c, sc in zip(chunks, flat):
                ranked.append({**c, "score": sc})
            ranked.sort(key=lambda x: x["score"], reverse=True)
            return ranked[:top_k]
    except Exception as e:
        logger.warning("cross-encoder failed, using retrieval scores: %s", e)
        return sorted(chunks, key=lambda c: float(c.get("score") or 0), reverse=True)[
            :top_k
        ]
