<div align="center">

```text
██████╗ ███████╗ ██████╗ █████╗ ██╗     ██╗           ██████╗ ███████╗
██╔══██╗██╔════╝██╔════╝██╔══██╗██║     ██║          ██╔═══██╗██╔════╝
██████╔╝█████╗  ██║     ███████║██║     ██║    ████╗ ██║   ██║███████╗
██╔══██╗██╔══╝  ██║     ██╔══██║██║     ██║          ██║   ██║╚════██║
██║  ██║███████╗╚██████╗██║  ██║███████╗███████╗     ╚██████╔╝███████║
╚═╝  ╚═╝╚══════╝ ╚═════╝╚═╝  ╚═╝╚══════╝╚══════╝      ╚═════╝ ╚══════╝
```

### Organizational memory for your documents · **v1.0.0**

Upload PDFs. Index them. Ask questions with hybrid retrieval and source citations.

</div>

---

# What is RecallOS?

A multimodal memory architecture for persistent retrieval over heterogeneous enterprise knowledge.

**Implemented**

- Multi-modality upload (PDF, images, audio, video) via MinIO presigned URLs
- Modality-aware ingestion pipeline with per-modality parser workers
- Dispatcher worker routes by MIME type → modality-specific Redis Streams
- Decoupled embedding worker (modality-agnostic, re-embeddable without reparsing)
- Hybrid search in Qdrant (dense BGE + sparse SPLADE, fused with RRF)
- Cross-encoder rerank → top chunks into the LLM
- Streaming chat with source chunk citations + optional modality filter
- Optional web research agent (`/web` + Exa)
- Projects with custom system prompts
- Chat history, pin/delete, and rolling conversation summaries
- Langfuse tracing for chat and ingest
- Dead Letter Queue for failed document processing
- `ParsedChunkSet` / `ParsedChunk` models for re-embeddable parsed output

---

# Tech Stack

| Layer             | Technology                                           |
| ----------------- | ---------------------------------------------------- |
| Monorepo          | Bun workspaces + Turborepo                           |
| Frontend          | Next.js (App Router), React, Tailwind                |
| Backend           | Express                                              |
| Runtime           | Bun                                                  |
| Auth              | JWT + bcrypt                                         |
| Queue             | Redis Streams (consumer groups, XAUTOCLAIM)          |
| Object storage    | MinIO (S3 API)                                       |
| Metadata          | PostgreSQL + Prisma                                  |
| Vectors           | Qdrant (dense + sparse named vectors)                |
| Dense embeddings  | BGE-small-en (`fastembed`)                           |
| Sparse embeddings | SPLADE++ EN v1 (`fastembed`)                         |
| Rerank            | Hugging Face cross-encoder (`ms-marco-MiniLM-L6-v2`) |
| Parsing           | LlamaParse (LlamaCloud)                              |
| LLM               | OpenRouter                                           |
| Web search        | Exa + LangGraph agent                                |
| Observability     | Langfuse (OpenTelemetry)                             |

---

# Repository Structure

```text
apps/
  web/          # Next.js UI (auth, dashboard, chat)
  backend/      # Express API + web agent
  workers/      # Multimodal ingestion workers
    dispatcher/ # Routes files_stream → modality streams
    pdf/        # LlamaParse → chunking → ParsedChunkSet
    image/      # Vision model + OCR (placeholder)
    audio/      # Whisper → transcript (placeholder)
    video/      # Scene detection (placeholder)
    scene/      # Keyframe → OCR + vision (placeholder)
    embedder/   # Modality-agnostic dense/sparse embed → Qdrant
    dlq/        # Dead Letter Queue reprocessing
    common/     # Shared helpers (MinIO download, etc.)

packages/
  db/           # Prisma schema + client (@repo/prisma)
  embed/        # Dense / sparse embed + cross-encoder
  qdrant/       # Qdrant client + collection setup
  redis-stream/ # Stream producer / consumer helpers
  minio/        # S3 client for MinIO
  openrouter/   # OpenRouter LLM client
  langfuse/     # Shared tracing helpers
  ui/           # Shared UI primitives
  eslint-config/
  typescript-config/

specs/          # Design notes used while building features
```

---

# Architecture

```text
  +-----------+         presigned PUT          +--------+
  |  Next.js  | -----------------------------> | MinIO  |
  |   web     |                                |(assets)|
  +-----+-----+                                +---+----+
        |                                          |
        | REST (JWT)                               | object key
        v                                          |
  +-----+-----+    xAdd to files_stream       +----v-----+
  |  Express  | ----------------------------> |  Redis   |
  |  backend  |                               | Streams  |
  +-----+-----+                               +----+-----+
        |                                          |
        | hybrid query + chat                      | Dispatcher
        |                                          | (routes by MIME)
        v                                          v
  +-----------+                            +-------+--------+
  |  Qdrant   |                            | pdf_stream     |
  | dense+    | <--- embed_stream          | image_stream   |
  | splade    |                            | audio_stream   |
  +-----------+    embedding worker        | video_stream   |
                                           +-------+--------+
        |                                          |
        |             +-----------+                |
        +-----------> | Postgres  | <--------------+
                      |  + users  |    Parser workers
                      |  + docs   |    (per modality)
                      |  + chunks |
                      |  + chats  |
                      +-----------+
        |
        v
  +-----------+
  | Postgres  |  users, documents, chats, messages, projects
  +-----------+
```

---

# Ingestion Pipeline

Documents of any modality are accepted (PDF, images, audio, video).

```text
1. Client requests presigned URL  →  POST /api/v1/upload/post-file-url
2. Client uploads bytes to MinIO
3. Client confirms upload         →  POST /api/v1/upload/confirm
      • verifies object size
      • creates Document (status UPLOADED)
      • enqueues on files_stream
4. Dispatcher reads files_stream, determines MIME type
5. Routes to modality stream: pdf_stream / image_stream / audio_stream / video_stream
6. Status → QUEUED
7. Modality parser worker claims job (XREADGROUP)
8. Status → PARSING
9. Modality-specific parsing:
   - PDF:    LlamaParse → markdown → semantic chunking
   - Image:  Vision model + OCR → description
   - Audio:  Whisper → transcript → semantic chunking
   - Video:  Scene detection → keyframe + OCR + vision + transcript
10. Creates ParsedChunkSet + ParsedChunks in DB
11. Pushes chunkSetId onto embed_stream
12. Status → PARSED
13. Embedding worker (modality-agnostic) claims job
14. Status → EMBEDDING
15. Dense (BGE) + sparse (SPLADE) embeddings → upsert to Qdrant
16. Status → READY (or FAILED on error)
```

Each stream has its own consumer group. Workers run a **stale-job reclaimer** (`XAUTOCLAIM`) per stream. After `MAX_RETRIES`, jobs move to a **Dead Letter Queue** (`dlq_stream`) for reprocessing or permanent failure.

Contextual chunk enrichment (LLM situates each chunk in the document) exists for non-`basic` pricing tiers.

---

# Retrieval & Chat

```text
User message
     │
     ▼
Embed query (dense BGE + sparse SPLADE)
     │
     ▼
Qdrant hybrid query
  prefetch dense top-50
  prefetch sparse top-50
  fuse with RRF → top 50
  (filtered to the user's documents)
     │
     ▼
Cross-encoder rerank → top 5
     │
     ▼
System prompt + recent chat history (+ optional project prompt)
     │
     ▼
OpenRouter stream (SSE)
     │
     ▼
Answer + sourceChunks stored on the assistant message
```

### Chat features

- Create session on first message
- Streamed replies over SSE
- Source chunks returned with each answer (id, score, text preview)
- List / load / pin / rename / delete chats
- Attach chats to **projects** (optional custom system prompt)
- Rolling **conversation summaries** injected into later prompts (other chats’ summaries + incremental summary of the current chat)
- **Web mode**: prefix or toggle `/web` to run a LangGraph research loop (Exa search → reason → refine → answer), with live step events in the UI

---

# API Surface

Base path: `/api/v1` (JWT middleware on all routes except auth).

| Area          | Methods                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------- |
| **Auth**      | `POST /auth/signup`, `POST /auth/signin`                                                  |
| **Upload**    | `POST /upload/post-file-url`, `POST /upload/confirm`                                      |
| **Documents** | `GET /download/list`, `POST /download/get-download-url`, `DELETE /download/:id`           |
| **Chat**      | `GET /chat`, `GET /chat/:id`, `PATCH /chat/:id`, `DELETE /chat/:id`, `POST /chat/message` |
| **Projects**  | `GET/POST /projects`, `PATCH/DELETE /projects/:id`                                        |

Document delete removes the Postgres row, MinIO object, stream job (if still queued), and matching Qdrant points.

---

# Frontend

| Route                | Purpose                                             |
| -------------------- | --------------------------------------------------- |
| `/`                  | Landing (or chat if signed in)                      |
| `/signin`, `/signup` | Auth                                                |
| `/dashboard`         | Upload PDFs, list status, download / delete         |
| `/chat`              | Full chat UI: history, projects, sources, web agent |

---

# Data Model (Postgres)

| Model      | Role                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------- |
| `User`           | Username + hashed password                                                              |
| `Document`       | Title, object key, `mimeType`, `modality`, status (`UPLOADED` → `READY` / `FAILED`)    |
| `ParsedChunkSet` | Group of parsed chunks for a document, per-modality, status (`PARSED` / `INDEXED`)     |
| `ParsedChunk`    | Individual text chunk with JSON metadata (page, timestamp, caption, OCR, etc.)         |
| `Project`        | Named workspace + optional system prompt                                                |
| `Chat`           | Title, pin, optional project, summary fields                                            |
| `Message`        | role, content, `sourceChunks` JSON                                                      |
| `Memory`         | Schema present for durable facts (not wired into chat yet)                              |

Chunk vectors live in **Qdrant** with payload including `documentId`, `chunkId`, `modality`, `page`, `timestamps`, `caption`. Chunk text is stored in both `ParsedChunk` (Postgres) and Qdrant.

---

# Storage Roles

| Store             | What it holds                                                  |
| ----------------- | -------------------------------------------------------------- |
| **MinIO**         | Original asset files (PDF, images, audio, video)               |
| **PostgreSQL**    | Users, docs, chunk sets, chunks, chats, messages, projects     |
| **Redis Streams** | Multi-stream job queue per modality + consumer group PEL + DLQ |
| **Qdrant**        | Per-chunk dense + SPLADE vectors and text payload with modality metadata |

There is **no OpenSearch** in this codebase. Lexical signal comes from **SPLADE sparse vectors** inside Qdrant, fused with dense cosine via RRF.

---

# Observability

`@repo/langfuse` instruments:

- Chat RAG turns (`hybrid-retrieve` → `cross-encode-rerank` → `generate-response`)
- Web research agent (LangGraph nodes)
- Document ingest (`process-document` and nested steps)

If Langfuse keys are missing, tracing no-ops.

---

# Local Development

### Prerequisites

- Bun ≥ 1.3
- PostgreSQL
- Redis
- MinIO
- Qdrant
- API keys: LlamaCloud, OpenRouter; optional HF, Exa, Langfuse

### Install & run

```bash
bun install

# Configure env (root and/or apps/*). See .env.example for a minimal set.
# Typical keys include DATABASE_URL, MinIO, JWT_SECRET, PORT,
# STREAM_NAME / GROUP_NAME, COLLECTION, DENSE_DIM, OPENROUTER_API_KEY,
# LLAMA_CLOUD_API_KEY, WORKER_ID, CONSUMER_GROUP, etc.

# Apply Prisma migrations (from packages/db)
cd packages/db && bunx prisma migrate dev

# From repo root — starts web, backend, workers via turbo
bun run dev
```

Or run apps individually:

```bash
bun run --filter web dev
bun run --filter backend dev   # or: cd apps/backend && bun run index.ts
bun run --filter workers dev   # or: cd apps/workers && bun run index.ts
```

---

# Design Principles (as built)

- **Async ingest** — uploads never block on parse/embed
- **Hybrid retrieval** — dense meaning + sparse terms, fused with RRF
- **Source grounded** — answers carry chunk citations
- **User scoped** — retrieval and deletes are filtered by ownership
- **Modular monorepo** — shared clients in `packages/*`
- **Observable** — optional Langfuse traces end to end
- **Decoupled parsing & embedding** — re-embed without reparsing via `ParsedChunkSet`
- **Extensible modalities** — new types need only a new parser worker; downstream pipeline unchanged

---
<!-- 
# Future scope

- PowerPoint / image / video ingest
- Whisper transcription or vision captioning
- OpenSearch / BM25 index
- Multi-tool planner agents (reports, slides, connectors)
- Graph memory, knowledge-graph extraction
- Slack / Discord / Gmail / calendar integrations
- MCP, voice UI, organization-wide multi-tenant OS features
- Durable `Memory` fact extraction (table only) -->

<!-- --- -->

<div align="center">

### RecallOS

**Search your PDFs. Cite your sources.**

</div>
