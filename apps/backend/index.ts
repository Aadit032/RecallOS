import dotenv from "dotenv";
dotenv.config();

// Initialize Langfuse OpenTelemetry before any LLM / agent imports run.
import { initTracing } from "@repo/langfuse/client";
initTracing({ serviceName: "backend" });

import cors from "cors";
import uploadRouter from "./routers/uploadRouter.ts";
import authRouter from "./routers/authRouter.ts";
import chatRouter from "./routers/chatRouter.ts";
import projectRouter from "./routers/projectRouter.ts";
import express from "express";
import middleware from "./middleware.ts";
import downloadRouter from "./routers/downloadRouter.ts";

const PORT = process.env.PORT;

const app = express();
app.use(cors());
app.use(express.json());
console.log(`[server] CORS and JSON parser middleware configured`);

app.use("/api/v1/auth", authRouter);
console.log(`[server] Registered: /api/v1/auth`);

app.use("/api/v1/upload", middleware, uploadRouter);
console.log(`[server] Registered: /api/v1/upload (with middleware)`);

app.use("/api/v1/download", middleware, downloadRouter);
console.log(`[server] Registered: /api/v1/download (with middleware)`);

app.use("/api/v1/chat", middleware, chatRouter);
console.log(`[server] Registered: /api/v1/chat (with middleware)`);

app.use("/api/v1/projects", middleware, projectRouter);
console.log(`[server] Registered: /api/v1/projects (with middleware)`);

app.listen(PORT, () => {
  console.log(`[server] RecallOS backend listening on port ${PORT}`);
});
