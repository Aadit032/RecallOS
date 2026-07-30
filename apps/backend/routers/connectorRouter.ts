import { Router } from "express";
import {
    createConnector,
    deleteConnector,
    listConnectors,
    runConnectorSync,
    setConnectorStatus,
    type ConnectorConfig,
    type ConnectorType,
} from "../services/connectorService.ts";
import { createConnectorSchema, updateConnectorSchema } from "../types.ts";

const connectorRouter = Router();

connectorRouter.get("/", async (req, res) => {
    const userId = req.userId;
    if (!userId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }
    try {
        const connectors = await listConnectors(userId);
        res.status(200).json({ connectors });
    } catch (e) {
        console.error("[GET /connectors]", e);
        res.status(500).json({
            message: "Failed to list connectors",
            error: e instanceof Error ? e.message : e,
        });
    }
});

connectorRouter.post("/", async (req, res) => {
    const userId = req.userId;
    if (!userId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }
    const parsed = createConnectorSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(422).json({ message: "Invalid input", error: parsed.error });
        return;
    }
    try {
        const connector = await createConnector({
            userId,
            type: parsed.data.type as ConnectorType,
            name: parsed.data.name,
            config: parsed.data.config as ConnectorConfig,
            syncInterval: parsed.data.syncInterval,
        });
        // Kick off first sync immediately (async)
        void runConnectorSync(connector.id);
        res.status(201).json({ connector });
    } catch (e) {
        console.error("[POST /connectors]", e);
        res.status(500).json({
            message: "Failed to create connector",
            error: e instanceof Error ? e.message : e,
        });
    }
});

connectorRouter.patch("/:id", async (req, res) => {
    const userId = req.userId;
    const id = req.params.id;
    if (!userId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }
    const parsed = updateConnectorSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(422).json({ message: "Invalid input", error: parsed.error });
        return;
    }
    try {
        if (parsed.data.status) {
            const connector = await setConnectorStatus(userId, id, parsed.data.status);
            if (!connector) {
                res.status(404).json({ message: "Connector not found" });
                return;
            }
            res.status(200).json({ connector });
            return;
        }
        res.status(422).json({ message: "No supported fields to update" });
    } catch (e) {
        console.error("[PATCH /connectors]", e);
        res.status(500).json({
            message: "Failed to update connector",
            error: e instanceof Error ? e.message : e,
        });
    }
});

connectorRouter.post("/:id/sync", async (req, res) => {
    const userId = req.userId;
    const id = req.params.id;
    if (!userId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }
    try {
        const { listConnectors: list } = await import("../services/connectorService.ts");
        const connectors = await list(userId);
        if (!connectors.some((c) => c.id === id)) {
            res.status(404).json({ message: "Connector not found" });
            return;
        }
        const result = await runConnectorSync(id);
        res.status(200).json(result);
    } catch (e) {
        console.error("[POST /connectors/:id/sync]", e);
        res.status(500).json({
            message: "Sync failed",
            error: e instanceof Error ? e.message : e,
        });
    }
});

connectorRouter.delete("/:id", async (req, res) => {
    const userId = req.userId;
    const id = req.params.id;
    if (!userId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }
    try {
        const ok = await deleteConnector(userId, id);
        if (!ok) {
            res.status(404).json({ message: "Connector not found" });
            return;
        }
        res.status(200).json({ message: "Connector deleted" });
    } catch (e) {
        console.error("[DELETE /connectors]", e);
        res.status(500).json({
            message: "Failed to delete connector",
            error: e instanceof Error ? e.message : e,
        });
    }
});

export default connectorRouter;
