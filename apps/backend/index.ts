import dotenv from "dotenv";
dotenv.config();

// Initialize Langfuse OpenTelemetry before any LLM / agent imports run.
import { initTracing } from "@repo/langfuse/client";
initTracing({ serviceName: "backend" });

import { createApp } from "./app.ts";

const PORT = process.env.PORT;

const app = createApp();
console.log(`[server] CORS and JSON parser middleware configured`);
console.log(`[server] Registered: /api/v1/auth`);
console.log(`[server] Registered: /api/v1/upload (with middleware)`);
console.log(`[server] Registered: /api/v1/download (with middleware)`);
console.log(`[server] Registered: /api/v1/chat (with middleware)`);
console.log(`[server] Registered: /api/v1/projects (with middleware)`);

app.listen(PORT, () => {
    console.log(`[server] RecallOS backend listening on port ${PORT}`);
});
