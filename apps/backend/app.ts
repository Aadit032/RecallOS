import cors from "cors";
import express from "express";
import authRouter from "./routers/authRouter.ts";
import uploadRouter from "./routers/uploadRouter.ts";
import downloadRouter from "./routers/downloadRouter.ts";
import chatRouter from "./routers/chatRouter.ts";
import projectRouter from "./routers/projectRouter.ts";
import middleware from "./middleware.ts";

/**
 * Build the Express application without binding a port.
 * Used by production entrypoint and HTTP tests.
 */
export function createApp() {
    const app = express();
    app.use(cors());
    app.use(express.json({ limit: "2mb" }));

    app.use("/api/v1/auth", authRouter);
    app.use("/api/v1/upload", middleware, uploadRouter);
    app.use("/api/v1/download", middleware, downloadRouter);
    app.use("/api/v1/chat", middleware, chatRouter);
    app.use("/api/v1/projects", middleware, projectRouter);

    return app;
}

export type App = ReturnType<typeof createApp>;
