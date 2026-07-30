# Changelog
<!-- 
## [2.1.0] - 2026-07-30

Major feature release: multi-hop RAG, long-term memory, connectors, multimodal citations, FastAPI backend port.

### Added
- **Search UI**: confidence % (0–100), longer preview excerpt, Preview dialog + download from search results
- **Dimmer upload background**: Athena art further subdued on the upload tab
- **Agentic multi-hop RAG**: `/agent` command + Brain toggle; plan → retrieve → reason → answer with streamed steps
- **Long-term Memory model**: extract durable facts after chats, inject into system prompts, CRUD at `/api/v1/memories`
- **External connectors + continuous sync**: URL / RSS / GitHub / Notion-URL connectors, manual sync, background poll loop
- **Citation-grounded multimodal answers**: sources include documentId, modality, page, timestamps, objectKey; source panel opens PDF/image/audio/video
- **FastAPI backend** (`apps/api`): full Python port of `/api/v1/*` with same features; optional Better Auth proxy via `AUTH_PROXY_URL`

### Changed
- Hybrid retrieval payload now surfaces page / timestamp / caption for grounding
- Chat system prompt includes long-term memories and citation guidance -->

## [2.0.0] - 2026-07-25

Multimodal ingestion release. RecallOS expands beyond PDF-only memory to images, audio, and video on the same hybrid retrieval stack.

### Added
- Multimodal upload: images, audio, and video alongside PDFs (MinIO presigned URLs)
- MIME-aware dispatcher that routes jobs to modality-specific Redis Streams
- Image worker: vision captions + OCR into searchable chunks
- Audio worker: Whisper transcription with timed transcript segments
- Video worker: FFmpeg scene detection; scene worker enriches each scene with keyframe vision and optional clip audio
- Shared worker utilities (`common/`): download, temp files, FFmpeg, vision, transcription, chunk metadata, stale-job reclaim
- `ParsedChunkSet` / `ParsedChunk` model for decoupled parse vs embed (re-embed without reparsing)
- Document `modality` and `tags` fields with payload stored on Qdrant points
- Modality-filtered hybrid search in chat and search routes
- Lexical tag match boosting on top of RRF scores
- Document `RETRYING` status for explicit reprocessing
- Dead Letter Queue worker path for failed ingestion jobs
- Concurrent multi-worker runtime under a single process with lazy embedding model load
- Modular chat UI (`components/chat-app/`, 14 focused modules)
- Multimodal architecture and migration specs

### Changed
- Ingestion architecture: `files_stream` → dispatcher → per-modality streams → `embed_stream`
- Embedder is modality-agnostic and consumes parsed chunk sets only
- Hybrid retrieval accepts modality filter and tag-aware scoring
- Dashboard is the default landing route; chat UI and controls refined
- Redis Streams helpers cleaned up for multi-stream worker operation
- README and agent docs updated for multimodal pipeline

### Fixed
- Stale job reclaim loop (`XAUTOCLAIM` / PEL) for worker consumer groups
- Audio pipeline reliability and FFmpeg path cleanup
- Image worker processing and chunk metadata headers
- Worker entrypoints no longer rely on separate `Bun.main` stream runners

### Infrastructure
- Prisma migrations: multimodal architecture, retrying status, document tags
- New worker packages/deps: vision, transcription (Hugging Face / OpenRouter), FFmpeg helpers
- Worker env surface expanded for modality streams and groups (`pdf`, `image`, `audio`, `video`, `scene`, `embed`, `dlq`)
- Removed obsolete per-package `CLAUDE.md` boilerplate

## [1.0.0] - 2026-07-17

### Added
- PDF upload via MinIO presigned URLs
- Async ingestion pipeline with Redis Streams, LlamaParse, and retry logic
- Hybrid search in Qdrant (dense BGE + sparse SPLADE, fused with RRF)
- Cross-encoder reranking for context selection
- Streaming chat with source chunk citations
- Web search agent with web graph traversal
- Langfuse tracing and observability
- Multi-tenant chunk isolation
- Document summarization and memory system
- Token counting and streaming
- Dashboard UI with document management, chat interface, and sidebar
- Authentication flow (sign in / sign up)
- Project and document CRUD routes
- Worker pipeline with live status and auto-claim from PEL

### Changed
- Revamped UI: removed landing page, improved chat interface
- Separated parsing configuration for production and development

### Fixed
- Qdrant upsert errors
- XPending and stale document processing in worker queues
- Polling logic with incremental backoff
- Various backend routing and environment configuration issues

### Infrastructure
- Monorepo with Turborepo, Bun, and TypeScript
- **apps**: `backend` (Express), `web` (Next.js), `workers` (background jobs)
- **packages**: `db` (Prisma), `embed`, `langfuse`, `minio`, `openrouter`, `qdrant`, `redis-stream`, `ui`
