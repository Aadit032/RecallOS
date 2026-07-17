Migration Plan: Current → Multimodal Architecture
Phase 0: Schema & Stream Prep (no behavior change)
Step	What	Details
0.1	Add mimeType to Document	Required for the dispatcher to route correctly. Backfill existing PDFs as application/pdf.
0.2	Create ParsedChunkSet + ParsedChunk models	New tables in Prisma. ParsedChunkSet links to Document, stores modality + status. ParsedChunk stores text + metadata JSON.
0.3	Add new env vars	FILES_STREAM, PDF_STREAM, IMAGE_STREAM, VIDEO_STREAM, AUDIO_STREAM, SCENE_STREAM, EMBED_STREAM — each with its own consumer group name. Keep current STREAM_NAME/GROUP_NAME for backward compat during migration.
0.4	Create new Redis streams	Ensure all streams + consumer groups exist at worker startup (MKSTREAM).
Phase 1: Decouple the Worker Pipeline
The biggest architectural change: split the monolithic worker into modality-agnostic stages.
Step	What	Details
1.1	Create embedding worker (new apps/workers/embedder/)	Consumes embed_stream, receives { chunkSetId }. Loads ParsedChunkSet → loads ParsedChunks → dense + sparse embed → upsert to Qdrant. Completely modality-agnostic. Qdrant payload now includes modality, page, timestamps from ParsedChunk.metadata.
1.2	Create dispatcher worker (new apps/workers/dispatcher/)	Consumes files_stream. Reads docId, fetches Document.mimeType, routes to pdf_stream / image_stream / video_stream / audio_stream. ACKs original message. No parsing.
1.3	Refactor PDF worker (apps/workers/)	Keep existing LlamaParse + chunking logic. Output changes: Instead of embedding + upserting directly, creates ParsedChunkSet + ParsedChunk rows in DB, then pushes { chunkSetId } to embed_stream. Status goes from PROCESSING → PARSED (not COMPLETED).
1.4	Update document statuses in DB	Add new enum values: UPLOADED, QUEUED, PARSING, PARSED, EMBEDDING, INDEXED, READY. Map current QUEUED→QUEUED, PROCESSING→PARSING, COMPLETED→READY, FAILED→FAILED.
1.5	Update upload flow (confirm route)	Push to files_stream instead of the old single stream. Status starts at UPLOADED, changes to QUEUED after dispatcher picks it up.
Phase 2: Modality Workers
Step	What	Details
2.1	Image worker	Consumes image_stream. Download from MinIO → Vision model (LLM describe) + OCR (Tesseract/OCR.space) → combine into ParsedChunkSet → push to embed_stream. Metadata includes { page: null, caption, ocr, boundingBoxes }.
2.2	Audio worker	Consumes audio_stream. Download → Whisper (speech-to-text) → transcript → semantic chunking → ParsedChunkSet → embed_stream.
2.3	Video worker	Consumes video_stream. Download → scene detection (PySceneDetect or similar) → push scenes to scene_stream.
2.4	Scene worker	Consumes scene_stream. For each scene: keyframe extraction → OCR + vision model + audio transcript (if available) → combine into ParsedChunkSet → embed_stream. Each scene becomes one semantic chunk.
Phase 3: Dead Letter Queue
Step	What	Details
3.1	Create DLQ stream	New dlq_stream — messages land here after exceeding retry limits.
3.2	Create DLQ worker	Consumes dlq_stream. Tries reprocessing once. If successful, re-routes to the appropriate modality stream. If not, marks document as FAILED. If DLQ worker also fails, document stays in DLQ for manual inspection.
3.3	Update claimLoop / XAUTOCLAIM	Instead of marking FAILED after MAX_RETRIES, move the message to dlq_stream.
Phase 4: Frontend
Step	What	Details
4.1	Widen file picker	Accept image/*, video/*, audio/* in addition to application/pdf.
4.2	Update upload flow	Send contentType to /post-file-url so MinIO key uses the correct prefix (or a generic one). Send mimeType in /confirm payload.
4.3	Update status display	Map new statuses to UI badges: UPLOADED (blue), QUEUED (dashed), PARSING (yellow), PARSED (purple), EMBEDDING (indigo), INDEXED (teal), READY (green), FAILED (red).
4.4	Pipeline diagram	Update the 4-step diagram in the dashboard to reflect the new multi-stage pipeline.
Phase 5: Chat / Retrieval Updates
Step	What	Details
5.1	Update Qdrant payload	During upsert (in the new embedding worker), include modality, page, timestampStart, timestampEnd, caption from ParsedChunk.metadata.
5.2	Optional: modality filter in chat	Allow users to filter retrieval by modality (e.g., "only search images"). This is a Qdrant filter addition on the modality field.
Phase 6: Cleanup
Step	What	Details
6.1	Remove old stream/group env vars	Once all workers are on the new streams, remove STREAM_NAME, GROUP_NAME, CONSUMER_GROUP env vars.
6.2	Remove old worker code	The legacy apps/workers/index.ts (embedding inside PDF worker) is replaced by the PDF parser worker + standalone embedding worker.
6.3	Update docs	README, CHANGELOG, architecture diagram.
Key Design Decisions
- Streams carry IDs only — no large payloads in Redis messages, just docId or chunkSetId. All heavy data goes through Postgres.
- Parsing ↔ Embedding decoupled — re-embedding doesn't require reparsing. Just push the existing chunkSetId back to embed_stream.
- New modality? Just add a new parser worker that writes ParsedChunkSet rows. The downstream embedder is unchanged.
- Existing data — Current COMPLETED documents already have their chunks only in Qdrant (no ParsedChunk rows). If you want re-embedding capability, you'd need a one-time migration to recreate ParsedChunkSet+ParsedChunk from Qdrant payloads. Otherwise, existing PDFs work as-is via the old Qdrant points.