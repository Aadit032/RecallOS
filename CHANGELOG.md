# Changelog

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
- **apps**: `backend` (Express/Hono), `web` (React), `workers` (background jobs)
- **packages**: `db` (Prisma), `embed`, `langfuse`, `minio`, `openrouter`, `qdrant`, `redis-stream`, `ui`
