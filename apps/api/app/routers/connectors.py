from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import resolve_user_id
from app.services.connectors import (
    create_connector,
    delete_connector,
    list_connectors,
    run_connector_sync,
    set_connector_status,
)

router = APIRouter(prefix="/api/v1/connectors", tags=["connectors"])


class CreateConnectorBody(BaseModel):
    type: str = Field(pattern="^(github|rss|url|notion)$")
    name: str = Field(min_length=1, max_length=120)
    config: dict = Field(default_factory=dict)
    syncInterval: int | None = Field(default=None, ge=5, le=24 * 60)


class UpdateConnectorBody(BaseModel):
    status: str | None = Field(default=None, pattern="^(ACTIVE|PAUSED)$")


def _ser(c: dict) -> dict:
    out = dict(c)
    for k in ("createdAt", "updatedAt", "lastSyncedAt", "startedAt", "finishedAt"):
        if out.get(k) is not None and hasattr(out[k], "isoformat"):
            out[k] = out[k].isoformat()
    if "jobs" in out:
        out["jobs"] = [_ser(j) for j in out["jobs"]]
    return out


@router.get("/")
async def get_connectors(user_id: str = Depends(resolve_user_id)):
    rows = await list_connectors(user_id)
    return {"connectors": [_ser(r) for r in rows]}


@router.post("/")
async def post_connector(
    body: CreateConnectorBody, user_id: str = Depends(resolve_user_id)
):
    c = await create_connector(
        user_id,
        body.type,
        body.name,
        body.config,
        body.syncInterval or 30,
    )
    asyncio.create_task(run_connector_sync(str(c["id"])))
    return {"connector": _ser(c)}


@router.patch("/{connector_id}")
async def patch_connector(
    connector_id: str,
    body: UpdateConnectorBody,
    user_id: str = Depends(resolve_user_id),
):
    if not body.status:
        raise HTTPException(status_code=422, detail={"message": "No fields to update"})
    c = await set_connector_status(user_id, connector_id, body.status)
    if not c:
        raise HTTPException(status_code=404, detail={"message": "Connector not found"})
    return {"connector": _ser(c)}


@router.post("/{connector_id}/sync")
async def sync_connector(
    connector_id: str, user_id: str = Depends(resolve_user_id)
):
    connectors = await list_connectors(user_id)
    if not any(str(c["id"]) == connector_id for c in connectors):
        raise HTTPException(status_code=404, detail={"message": "Connector not found"})
    return await run_connector_sync(connector_id)


@router.delete("/{connector_id}")
async def remove_connector(
    connector_id: str, user_id: str = Depends(resolve_user_id)
):
    ok = await delete_connector(user_id, connector_id)
    if not ok:
        raise HTTPException(status_code=404, detail={"message": "Connector not found"})
    return {"message": "Connector deleted"}
