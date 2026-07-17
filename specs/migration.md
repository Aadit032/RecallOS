# Migration Plan: Current → Multimodal Architecture

**Status: ✅ Complete** — all phases implemented as of v1.0.

## Phase 0: Schema & Stream Prep (✅)
- Added `mimeType`, `modality` to Document
- Created `ParsedChunkSet` + `ParsedChunk` models
- Added new env vars for multimodal streams
- Created all Redis streams + consumer groups

## Phase 1: Decouple Worker Pipeline (✅)
- Created embedding worker (`apps/workers/embedder/`) — modality-agnostic
- Created dispatcher worker (`apps/workers/dispatcher/`) — routes by MIME
- Refactored PDF worker to stop at `ParsedChunkSet`, push to `embed_stream`
- Updated document statuses: `UPLOADED` → `READY`
- Updated upload flow to push to `files_stream`

## Phase 2: Modality Workers (✅ — placeholders)
- Image worker scaffold (vision + OCR to be wired)
- Audio worker scaffold (Whisper to be wired)
- Video worker scaffold (scene detection to be wired)
- Scene worker scaffold (keyframe + OCR to be wired)

## Phase 3: Dead Letter Queue (✅)
- Created `dlq_stream` + DLQ worker
- Updated XAUTOCLAIM to route to DLQ after max retries

## Phase 4: Frontend (✅)
- Widened file picker to accept all media types
- Updated status display with new pipeline states
- Updated pipeline diagram to 5 stages
- Added audio/video preview support

## Phase 5: Chat / Retrieval (✅)
- Qdrant payload includes `modality`, `page`, `timestamps`, `caption`, `chunkSetId`
- Optional `modality` filter in chat message requests

## Phase 6: Cleanup (✅)
- Prisma migration applied
- README updated with new architecture
- Old `STREAM_NAME` / `GROUP_NAME` env vars preserved for backward compat

## Key Design Decisions
- Streams carry IDs only — no large payloads in Redis messages, just `docId` or `chunkSetId`
- Parsing ↔ Embedding decoupled — re-embedding doesn't require reparsing
- New modality? Just add a new parser worker that writes `ParsedChunkSet` rows
- Existing data — Current `COMPLETED` documents already have their chunks only in Qdrant (no `ParsedChunk` rows). One-time migration can recreate from Qdrant payloads if re-embedding needed.
