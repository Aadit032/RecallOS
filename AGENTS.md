# RecallOS — Agent Guide

## Toolchain

| Command | Purpose |
|---|---|
| `bun install` | Install dependencies (Bun workspaces, not npm/pnpm) |
| `bun run dev` | Start all apps via Turborepo |
| `bun run --filter web dev` | Next.js 16 on port 3001 |
| `bun run --filter backend dev` | Express 5 on port 3000 |
| `bun run --filter workers dev` | All workers concurrently |
| `bun run --filter workers dev:<worker>` | Single worker (e.g. `dev:pdf`, `dev:embedder`, `dev:dlq`) |
| `cd packages/db && bunx prisma migrate dev` | Apply Prisma migrations |
| `bun run lint` | ESLint via turbo (web only has `--max-warnings 0`) |
| `bun run check-types` | TypeScript check via turbo |
| `bun run format` | Prettier (`--write "**/*.{ts,tsx,md}"`) |
| `bun run build` | Build via turbo |

## Monorepo structure

- **`apps/web`** — Next.js App Router, React 19, Tailwind CSS v4 (postcss config)
- **`apps/backend`** — Express 5 API, JWT middleware on all routes except auth
- **`apps/workers/`** — Modality workers (dispatcher, pdf, image, audio, video, scene, embedder, dlq), each a `bun <dir>/index.ts` process
- **`packages/`** — Shared libs published as `@repo/*`, each exports from `"./client"` subpath

## Package exports pattern

All shared packages re-export via `"./client"`:
```ts
import { prismaClient } from "@repo/prisma/client";
import { someExport } from "@repo/qdrant/client";
```

## Architecture notes

- **Backend is Express 5** — NOT `Bun.serve()`. The boilerplate CLAUDE.md files in sub-packages say otherwise; ignore them.
- **Redis** uses the `redis` npm package (`packages/redis-stream`), NOT `Bun.redis` or `ioredis`.
- **Postgres** uses Prisma 7 + `@prisma/adapter-pg` (`packages/db`), NOT `Bun.sql`.
- **MinIO** uses AWS SDK v3 S3 client (`@aws-sdk/client-s3`).
- **Embeddings**: `fastembed` (local BGE-small-en dense + SPLADE sparse) + HuggingFace Inference API (cross-encoder).
- **Workers** are standalone Bun processes. The root `workers/index.ts` spawns all via `Bun.spawn`.
- **Langfuse tracing** no-ops if env keys are absent.
- **Env**: Bun loads `.env` automatically. Backend also calls `dotenv.config()` explicitly (needed before Prisma/init imports).
- **Prisma client** is generated to `packages/db/generated/prisma/`.
- **API base path**: `/api/v1` — JWT middleware on all routes except `/auth/*`.
- **No tests** exist in the codebase.

## Required services (local dev)

PostgreSQL, Redis, MinIO, Qdrant, plus API keys for LlamaCloud & OpenRouter. No docker-compose in repo — run these separately.
