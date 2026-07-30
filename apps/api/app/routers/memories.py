from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import resolve_user_id
from app.services.memory import create_memory, delete_memory, list_memories

router = APIRouter(prefix="/api/v1/memories", tags=["memories"])


class CreateMemoryBody(BaseModel):
    fact: str = Field(min_length=3, max_length=500)
    importance: int = Field(default=5, ge=1, le=10)


def _serialize(m: dict) -> dict:
    out = dict(m)
    for k in ("createdAt", "updatedAt", "lastUsedAt"):
        if out.get(k) is not None:
            out[k] = out[k].isoformat()
    return out


@router.get("/")
async def get_memories(user_id: str = Depends(resolve_user_id)):
    rows = await list_memories(user_id)
    return {"memories": [_serialize(r) for r in rows]}


@router.post("/")
async def post_memory(body: CreateMemoryBody, user_id: str = Depends(resolve_user_id)):
    m = await create_memory(user_id, body.fact, body.importance)
    return {"memory": _serialize(m)}


@router.delete("/{memory_id}")
async def remove_memory(memory_id: str, user_id: str = Depends(resolve_user_id)):
    ok = await delete_memory(user_id, memory_id)
    if not ok:
        raise HTTPException(status_code=404, detail={"message": "Memory not found"})
    return {"message": "Memory deleted"}
