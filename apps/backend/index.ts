import dotenv from "dotenv";
dotenv.config();

// Initialize Langfuse OpenTelemetry before any LLM / agent imports run.
import { initTracing } from "@repo/langfuse/client";
initTracing({ serviceName: "backend" });

import cors from "cors";
import express from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.ts";
import uploadRouter from "./routers/uploadRouter.ts";
import chatRouter from "./routers/chatRouter.ts";
import projectRouter from "./routers/projectRouter.ts";
import middleware from "./middleware.ts";
import downloadRouter from "./routers/downloadRouter.ts";
import searchRouter from "./routers/searchRouter.ts";
import memoryRouter from "./routers/memoryRouter.ts";
import connectorRouter from "./routers/connectorRouter.ts";
import { runDueConnectorSyncs } from "./services/connectorService.ts";
import { createRateLimiter } from "./security/rateLimit.ts";

const PORT = process.env.PORT;
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:3001";

if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) {
  console.error(
    "[server] FATAL: BETTER_AUTH_SECRET must be set and at least 32 characters (openssl rand -base64 32)"
  );
  process.exit(1);
}

const app = express();

// Do not advertise Express; reduce fingerprinting slightly
app.disable("x-powered-by");

// Baseline security headers (API responses)
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // Intentionally omit CORP so the SPA origin (CORS-allowlisted) can read responses
  next();
});

// CORS must allow credentials for cookie-based sessions (cross-origin web → API).
app.use(
  cors({
    origin: FRONTEND_URL,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  })
);
console.log(`[server] CORS configured for origin=${FRONTEND_URL} (credentials)`);

// Better Auth handler — must be mounted BEFORE express.json()
// Express 5 uses *splat for catch-all routes.
app.all("/api/auth/*splat", toNodeHandler(auth));
console.log(`[server] Registered: /api/auth/* (Better Auth)`);

// Cap JSON body size to limit memory DoS (chat messages are already schema-capped)
app.use(express.json({ limit: "1mb" }));
console.log(`[server] JSON parser middleware configured (limit=1mb)`);

// Baseline rate limits (per authenticated user when middleware sets userId)
const generalLimiter = createRateLimiter({
  name: "api",
  windowMs: 60_000,
  max: 120,
});
const chatLimiter = createRateLimiter({
  name: "chat",
  windowMs: 60_000,
  max: 30,
});
const uploadLimiter = createRateLimiter({
  name: "upload",
  windowMs: 60_000,
  max: 40,
});
const searchLimiter = createRateLimiter({
  name: "search",
  windowMs: 60_000,
  max: 60,
});
const connectorLimiter = createRateLimiter({
  name: "connectors",
  windowMs: 60_000,
  max: 20,
});

app.use("/api/v1/upload", middleware, uploadLimiter, uploadRouter);
console.log(`[server] Registered: /api/v1/upload (with middleware)`);

app.use("/api/v1/download", middleware, generalLimiter, downloadRouter);
console.log(`[server] Registered: /api/v1/download (with middleware)`);

app.use("/api/v1/search", middleware, searchLimiter, searchRouter);
console.log(`[server] Registered: /api/v1/search (with middleware)`);

app.use("/api/v1/chat", middleware, chatLimiter, chatRouter);
console.log(`[server] Registered: /api/v1/chat (with middleware)`);

app.use("/api/v1/projects", middleware, generalLimiter, projectRouter);
console.log(`[server] Registered: /api/v1/projects (with middleware)`);

app.use("/api/v1/memories", middleware, generalLimiter, memoryRouter);
console.log(`[server] Registered: /api/v1/memories (with middleware)`);

app.use("/api/v1/connectors", middleware, connectorLimiter, connectorRouter);
console.log(`[server] Registered: /api/v1/connectors (with middleware)`);

app.listen(PORT, () => {
  console.log(`[server] RecallOS backend listening on port ${PORT}`);
});

// Continuous connector sync loop (every 60s check for due connectors)
const CONNECTOR_SYNC_MS = Number(process.env.CONNECTOR_SYNC_POLL_MS ?? 60_000);
setInterval(() => {
  void runDueConnectorSyncs(5).then((n) => {
    if (n > 0) console.log(`[connectors] Continuous sync ran ${n} connector(s)`);
  }).catch((e) => console.error("[connectors] sync loop error", e));
}, CONNECTOR_SYNC_MS);
