import { Router } from "express";
import { prismaClient } from "@repo/prisma/client";
import { createProjectSchema, updateProjectSchema } from "../types";

const projectRouter = Router();

/**
 * List projects for the authenticated user.
 */
projectRouter.get("/", async (req, res) => {
    const userId = req.userId;
    console.log(`[GET /projects] userId=${userId}`);
    if (!userId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }

    try {
        const projects = await prismaClient.project.findMany({
            where: { userId },
            orderBy: { updatedAt: "desc" },
            select: {
                id: true,
                name: true,
                systemPrompt: true,
                createdAt: true,
                updatedAt: true,
                _count: { select: { chats: true } },
            },
        });

        res.status(200).json({
            projects: projects.map(({ _count, ...p }) => ({
                ...p,
                chatCount: _count.chats,
            })),
        });
    } catch (e) {
        console.error(`[GET /projects] Error:`, e);
        res.status(500).json({
            message: "Failed to list projects",
            error: e instanceof Error ? e.message : e,
        });
    }
});

/**
 * Create a project.
 */
projectRouter.post("/", async (req, res) => {
    const userId = req.userId;
    console.log(`[POST /projects] userId=${userId}, body=${JSON.stringify(req.body)}`);
    if (!userId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }

    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(422).json({ message: "Invalid input", error: parsed.error });
        return;
    }

    try {
        const project = await prismaClient.project.create({
            data: {
                userId,
                name: parsed.data.name,
                systemPrompt: parsed.data.systemPrompt ?? null,
            },
        });
        console.log(`[POST /projects] Created project ${project.id}`);
        res.status(201).json({ project });
    } catch (e) {
        console.error(`[POST /projects] Error:`, e);
        res.status(500).json({
            message: "Failed to create project",
            error: e instanceof Error ? e.message : e,
        });
    }
});

/**
 * Update project name / system prompt.
 */
projectRouter.patch("/:id", async (req, res) => {
    const userId = req.userId;
    const id = req.params.id;
    console.log(`[PATCH /projects/:id] userId=${userId}, id=${id}`);
    if (!userId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }

    const parsed = updateProjectSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(422).json({ message: "Invalid input", error: parsed.error });
        return;
    }

    if (Object.keys(parsed.data).length === 0) {
        res.status(422).json({ message: "No fields to update" });
        return;
    }

    try {
        const existing = await prismaClient.project.findFirst({
            where: { id, userId },
        });
        if (!existing) {
            res.status(404).json({ message: "Project not found" });
            return;
        }

        const project = await prismaClient.project.update({
            where: { id },
            data: parsed.data,
        });
        console.log(`[PATCH /projects/:id] Updated project ${id}`);
        res.status(200).json({ project });
    } catch (e) {
        console.error(`[PATCH /projects/:id] Error:`, e);
        res.status(500).json({
            message: "Failed to update project",
            error: e instanceof Error ? e.message : e,
        });
    }
});

/**
 * Delete a project. Chats keep their messages; projectId is set null (FK onDelete SetNull).
 */
projectRouter.delete("/:id", async (req, res) => {
    const userId = req.userId;
    const id = req.params.id;
    console.log(`[DELETE /projects/:id] userId=${userId}, id=${id}`);
    if (!userId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }

    try {
        const existing = await prismaClient.project.findFirst({
            where: { id, userId },
        });
        if (!existing) {
            res.status(404).json({ message: "Project not found" });
            return;
        }

        await prismaClient.project.delete({ where: { id } });
        console.log(`[DELETE /projects/:id] Deleted project ${id}`);
        res.status(200).json({ message: "Project deleted" });
    } catch (e) {
        console.error(`[DELETE /projects/:id] Error:`, e);
        res.status(500).json({
            message: "Failed to delete project",
            error: e instanceof Error ? e.message : e,
        });
    }
});

export default projectRouter;
