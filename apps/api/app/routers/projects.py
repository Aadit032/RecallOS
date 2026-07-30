from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import resolve_user_id
from app.db import get_pool

router = APIRouter(prefix="/api/v1/projects", tags=["projects"])


class CreateProject(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    systemPrompt: str | None = None


class UpdateProject(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    systemPrompt: str | None = None


@router.get("/")
async def list_projects(user_id: str = Depends(resolve_user_id)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT p.*, (SELECT COUNT(*) FROM "Chat" c WHERE c."projectId" = p.id) AS chat_count
            FROM "Project" p
            WHERE p."userId" = $1
            ORDER BY p."updatedAt" DESC
            """,
            user_id,
        )
    projects = []
    for r in rows:
        d = dict(r)
        d["chatCount"] = int(d.pop("chat_count", 0))
        d["createdAt"] = d["createdAt"].isoformat() if d.get("createdAt") else None
        d["updatedAt"] = d["updatedAt"].isoformat() if d.get("updatedAt") else None
        projects.append(d)
    return {"projects": projects}


@router.post("/")
async def create_project(body: CreateProject, user_id: str = Depends(resolve_user_id)):
    pid = str(uuid.uuid4())
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO "Project" (id, name, "systemPrompt", "userId", "createdAt", "updatedAt")
            VALUES ($1,$2,$3,$4,NOW(),NOW()) RETURNING *
            """,
            pid,
            body.name,
            body.systemPrompt,
            user_id,
        )
    d = dict(row)
    d["createdAt"] = d["createdAt"].isoformat()
    d["updatedAt"] = d["updatedAt"].isoformat()
    return {"project": d}


@router.patch("/{project_id}")
async def update_project(
    project_id: str, body: UpdateProject, user_id: str = Depends(resolve_user_id)
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        existing = await conn.fetchrow(
            'SELECT id FROM "Project" WHERE id = $1 AND "userId" = $2',
            project_id,
            user_id,
        )
        if not existing:
            raise HTTPException(status_code=404, detail={"message": "Project not found"})
        if body.name is not None:
            await conn.execute(
                'UPDATE "Project" SET name = $2, "updatedAt" = NOW() WHERE id = $1',
                project_id,
                body.name,
            )
        if body.systemPrompt is not None:
            await conn.execute(
                'UPDATE "Project" SET "systemPrompt" = $2, "updatedAt" = NOW() WHERE id = $1',
                project_id,
                body.systemPrompt,
            )
        row = await conn.fetchrow('SELECT * FROM "Project" WHERE id = $1', project_id)
    d = dict(row)
    d["createdAt"] = d["createdAt"].isoformat()
    d["updatedAt"] = d["updatedAt"].isoformat()
    return {"project": d}


@router.delete("/{project_id}")
async def delete_project(project_id: str, user_id: str = Depends(resolve_user_id)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            'DELETE FROM "Project" WHERE id = $1 AND "userId" = $2',
            project_id,
            user_id,
        )
    if not result.endswith("1"):
        raise HTTPException(status_code=404, detail={"message": "Project not found"})
    return {"message": "Project deleted"}
