import { Router } from "express";
import {
    createMemory,
    deleteMemory,
    listMemories,
} from "../services/memoryService.ts";
import { createMemorySchema } from "../types.ts";

const memoryRouter = Router();

memoryRouter.get("/", async (req, res) => {
    const userId = req.userId;
    if (!userId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }
    try {
        const memories = await listMemories(userId);
        res.status(200).json({ memories });
    } catch (e) {
        console.error("[GET /memories]", e);
        res.status(500).json({
            message: "Failed to list memories",
            error: e instanceof Error ? e.message : e,
        });
    }
});

memoryRouter.post("/", async (req, res) => {
    const userId = req.userId;
    if (!userId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }
    const parsed = createMemorySchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(422).json({ message: "Invalid input", error: parsed.error });
        return;
    }
    try {
        const memory = await createMemory(
            userId,
            parsed.data.fact,
            parsed.data.importance ?? 5
        );
        res.status(201).json({ memory });
    } catch (e) {
        console.error("[POST /memories]", e);
        res.status(500).json({
            message: "Failed to create memory",
            error: e instanceof Error ? e.message : e,
        });
    }
});

memoryRouter.delete("/:id", async (req, res) => {
    const userId = req.userId;
    const id = req.params.id;
    if (!userId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }
    try {
        const ok = await deleteMemory(userId, id);
        if (!ok) {
            res.status(404).json({ message: "Memory not found" });
            return;
        }
        res.status(200).json({ message: "Memory deleted" });
    } catch (e) {
        console.error("[DELETE /memories]", e);
        res.status(500).json({
            message: "Failed to delete memory",
            error: e instanceof Error ? e.message : e,
        });
    }
});

export default memoryRouter;
