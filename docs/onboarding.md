# Onboarding guide

Welcome to **RecallOS**. This guide gets a new developer productive on day one.

---

## 1. What you are building

RecallOS is a multimodal knowledge OS:

1. Users sign in with Google.
2. They upload PDFs / media (or sync connectors).
3. Workers parse and embed into Qdrant.
4. Chat uses hybrid RAG (and optional `/web` or `/agent` modes).

Read next (in order):

1. [Architecture](./architecture.md)  
2. [Sequence diagrams](./sequence-diagrams.md)  
3. [API](./api.md)  
4. Root [README](../README.md) + [AGENTS.md](../AGENTS.md)

---

## 2. Prerequisites

| Tool | Version / notes |
|------|-----------------|
| [Bun](https://bun.sh) | ≥ 1.3 |
| [Docker](https://docs.docker.com/get-docker/) | For Postgres, Redis, MinIO, Qdrant |
| [ffmpeg](https://ffmpeg.org) | Optional; required for video/scene workers |
| Git | — |
| Google Cloud OAuth credentials | For sign-in |
| API keys | **Required:** LlamaCloud, OpenRouter. **Optional:** Exa, HF, Langfuse |

OS: Linux or macOS recommended (this project is developed with Bun on Linux).

---

## 3. One-shot setup

From an empty machine:

```bash
curl -fsSL https://raw.githubusercontent.com/Aadit032/RecallOS/refs/heads/main/scripts/setup.sh | bash
```

Or from a clone:

```bash
git clone https://github.com/Aadit032/RecallOS.git
cd RecallOS
bash scripts/setup.sh
```

The script:

- Starts Docker containers: Postgres, Redis, MinIO, Qdrant  
- Runs `bun install`  
- Copies env template if needed  
- Applies Prisma migrations  

Then fill secrets in `.env` (see below) and start apps.

---

## 4. Manual setup

### 4.1 Clone and install

```bash
git clone https://github.com/Aadit032/RecallOS.git
cd RecallOS
bun install
```

### 4.2 Start infrastructure

```bash
# Postgres
docker run -d --name recallos-postgres \
  -p 5432:5432 \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=recallOs \
  --restart unless-stopped \
  postgres:16-alpine

# Redis
docker run -d --name recallos-redis \
  -p 6379:6379 \
  --restart unless-stopped \
  redis:7-alpine

# MinIO
docker run -d --name recallos-minio \
  -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=admin \
  -e MINIO_ROOT_PASSWORD=password123 \
  --restart unless-stopped \
  minio/minio server /data --console-address ":9001"

# Qdrant
docker run -d --name recallos-qdrant \
  -p 6333:6333 -p 6334:6334 \
  --restart unless-stopped \
  qdrant/qdrant
```

| Service | URL | Dev credentials |
|---------|-----|-----------------|
| Postgres | `localhost:5432` | `postgres` / `password` |
| Redis | `localhost:6379` | — |
| MinIO API | `http://localhost:9000` | `admin` / `password123` |
| MinIO Console | `http://localhost:9001` | same |
| Qdrant | `http://localhost:6333` | — |

### 4.3 Environment

```bash
cp .env.example .env
```

**Minimum to run chat + ingest:**

```bash
# Generate auth secret
openssl rand -base64 32   # paste into BETTER_AUTH_SECRET (min 32 chars)

DATABASE_URL=postgresql://postgres:password@localhost:5432/recallOs
REDIS_URL=redis://localhost:6379
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESSKEYID=admin
MINIO_SECRET_ACCESS_KEY=password123
AWS_BUCKET_NAME=recallos
PORT=3000
FRONTEND_URL=http://localhost:3001
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=<generated>
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
LLAMA_CLOUD_API_KEY=...
OPENROUTER_API_KEY=...
HOST=localhost
COLLECTION=recallos
DENSE_DIM=384
WORKER_ID=worker-1
# plus stream names from .env.example
```

Google OAuth: authorized redirect URI must match Better Auth callback on `BETTER_AUTH_URL` (e.g. `http://localhost:3000/api/auth/callback/google`).

Optional:

- `EXA_API_KEY` — `/web` mode  
- `HF_TOKEN` — cross-encoder rerank  
- `LANGFUSE_*` — tracing  

Bun loads `.env` from the working directory; packages may have their own `.env` for isolated tooling—prefer a **root** `.env` for `bun run dev`.

### 4.4 Database

```bash
cd packages/db
bunx prisma migrate dev
cd ../..
```

Prisma client is generated to `packages/db/generated/prisma/`.

### 4.5 Run apps

```bash
# All workspaces via Turborepo
bun run dev

# Or individually
bun run --filter web dev        # :3001
bun run --filter backend dev    # :3000
bun run --filter workers dev    # ingestion
```

Open `http://localhost:3001` → sign in → dashboard → upload a PDF → wait until status `READY` → chat.

---

## 5. Day-one verification checklist

- [ ] Docker containers running (`docker ps`)  
- [ ] `bun run --filter backend dev` starts (fails if `BETTER_AUTH_SECRET` weak)  
- [ ] Google sign-in works  
- [ ] Upload small PDF → document becomes `READY`  
- [ ] Chat answers with sources  
- [ ] Optional: `/web` with Exa key  
- [ ] MinIO console shows object under `uploads/{userId}/…`  

---

## 6. Codebase map (where to edit)

| Task | Start here |
|------|------------|
| New API route | `apps/backend/routers/`, mount in `index.ts` |
| Chat / RAG logic | `services/chatService.ts`, `hybridRetrieve.ts`, `chatRouter.ts` |
| Agents | `apps/backend/agents/` |
| Upload policy | `security/uploadPolicy.ts`, `uploadRouter.ts` |
| Connector SSRF | `security/ssrf.ts`, `connectorService.ts` |
| New modality worker | `apps/workers/<modality>/`, route in `dispatcher` |
| Embeddings | `packages/embed`, `workers/embedder` |
| Schema change | `packages/db/prisma/schema.prisma` + migrate |
| Chat UI | `apps/web/components/chat-app/` |
| Dashboard | `apps/web/app/dashboard/page.tsx` |

---

## 7. Conventions

### Toolchain

| Command | Purpose |
|---------|---------|
| `bun install` | Install (workspaces, not npm) |
| `bun run dev` | All apps |
| `bun run lint` | ESLint |
| `bun run check-types` | Typecheck |
| `bun run format` | Prettier |
| `bun run build` | Production build |

### Patterns

- Backend is **Express 5**, not `Bun.serve()`.  
- Redis package is `redis` via `@repo/redis-stream`, not ioredis.  
- Postgres via Prisma 7 + `@prisma/adapter-pg`.  
- MinIO via AWS SDK v3 S3 client.  
- No test suite currently—prefer manual paths above; add tests when changing security-critical code.  

### Agent / AI coding

See [AGENTS.md](../AGENTS.md) for monorepo rules used by coding agents.

---

## 8. Common pitfalls

| Symptom | Fix |
|---------|-----|
| Backend exits immediately | Set `BETTER_AUTH_SECRET` ≥ 32 chars |
| CORS errors | Align `FRONTEND_URL` with browser origin |
| OAuth redirect mismatch | Fix Google console redirect + `BETTER_AUTH_URL` |
| Upload confirm 403 | Key must match `uploads/{userId}/…`; re-request presign after login |
| Documents stuck `UPLOADED` | Workers not running or Redis stream names mismatch |
| Video never processes | Install ffmpeg/ffprobe |
| Empty retrieval | Doc not `READY`; wrong user; Qdrant collection empty |
| Cross-encoder fails | Set `HF_TOKEN` or accept degraded path if any |

---

## 9. Suggested first tasks

1. Trace one upload from UI → MinIO → Redis → worker logs → Qdrant.  
2. Read `hybridRetrieve.ts` and hit search with a known tag.  
3. Add a log line in `buildSystemPrompt` and send a chat message.  
4. Create a GitHub connector against a public repo.  
5. Skim [audit.md](../audit.md) security controls.  

---

## 10. Getting help

- Architecture questions → [architecture.md](./architecture.md)  
- API contract → [api.md](./api.md)  
- Production → [deployment.md](./deployment.md)  
- Incidents → [disaster-recovery.md](./disaster-recovery.md)  

Happy hacking.
