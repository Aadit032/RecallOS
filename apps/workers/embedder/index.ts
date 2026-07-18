import dotenv from "dotenv";
dotenv.config();

import { initTracing, startActiveObservation, propagateAttributes } from "@repo/langfuse/client";
initTracing({ serviceName: "embedding-worker" });

import { ensureStream, xReadGroupFromStream, xAckOnStream, xAddToStream } from "@repo/redis-stream/client";
import { prismaClient } from "@repo/prisma/client";
import { getDenseVectors, getSparseVectors } from "@repo/embed/client";
import { qdrantClient } from "@repo/qdrant/client";
import { v4 as uuidv4 } from "uuid";
import { startClaimLoop } from "../common/claimStaleJobs.ts";

const EMBED_STREAM = process.env.EMBED_STREAM as string;
const EMBED_GROUP = process.env.EMBED_GROUP as string;
const DLQ_STREAM = process.env.DLQ_STREAM as string;
const WORKER_ID = process.env.WORKER_ID as string;
const COLLECTION = process.env.COLLECTION as string;

const MAX_RETRIES = 5;
const IDLE_THRESHOLD_MS = 30 * 60 * 1000;
const CLAIM_INTERVAL_MS = 30 * 1000;

async function ensureStreams() {
    await ensureStream(EMBED_STREAM, EMBED_GROUP);
}

export async function embedChunkSet(chunkSetId: string) {
    return startActiveObservation(
        "embed-chunk-set",
        async (root) => {
            root.update({ input: { chunkSetId } });

            return propagateAttributes(
                {
                    tags: ["ingest", "embedding"],
                    metadata: { chunkSetId, workerId: WORKER_ID },
                },
                async () => {
                    const chunkSet = await prismaClient.parsedChunkSet.findUnique({
                        where: { id: chunkSetId },
                        include: { chunks: true, document: { select: { id: true, userId: true } } },
                    });

                    if (!chunkSet) {
                        console.log(`[embedder] ChunkSet ${chunkSetId} not found — acking`);
                        return;
                    }

                    const documentId = chunkSet.documentId;
                    const userId = chunkSet.document.userId;
                    const modality = chunkSet.modality;

                    await prismaClient.document.update({
                        where: { id: documentId },
                        data: { status: "EMBEDDING" },
                    });

                    const texts = chunkSet.chunks.map(c => c.text);

                    try {
                        const [sparseVectors, embeddings] = await Promise.all([
                            startActiveObservation("sparse-embed", async (emb) => {
                                emb.update({ input: { count: texts.length }, model: "splade-pp-en-v1" });
                                const vectors = await getSparseVectors(texts);
                                emb.update({ output: { count: vectors.length } });
                                return vectors;
                            }, { asType: "embedding" }),
                            startActiveObservation("dense-embed", async (emb) => {
                                emb.update({ input: { count: texts.length }, model: "bge-small-en" });
                                const vectors = await getDenseVectors(texts);
                                emb.update({ output: { count: vectors.length, dims: vectors[0]?.length ?? 0 } });
                                return vectors;
                            }, { asType: "embedding" }),
                        ]);

                        const points = chunkSet.chunks.map((chunk, i) => {
                            const metadata = (chunk.metadata as Record<string, unknown>) ?? {};
                            return {
                                id: uuidv4(),
                                vector: {
                                    dense: Array.from(embeddings[i]!),
                                    splade: {
                                        indices: Array.from(sparseVectors[i]!.indices),
                                        values: Array.from(sparseVectors[i]!.values),
                                    },
                                },
                                payload: {
                                    text: chunk.text,
                                    userId,
                                    documentId,
                                    chunkId: chunk.id,
                                    modality,
                                    chunkSetId,
                                    page: metadata.page ?? null,
                                    timestampStart: metadata.timestampStart ?? null,
                                    timestampEnd: metadata.timestampEnd ?? null,
                                    caption: metadata.caption ?? null,
                                },
                            };
                        });

                        await qdrantClient.upsert(COLLECTION, { wait: true, points });
                        console.log(`[embedder] Upserted ${points.length} points for chunkSetId="${chunkSetId}"`);

                        await prismaClient.document.update({
                            where: { id: documentId },
                            data: { status: "READY" },
                        });

                        await prismaClient.parsedChunkSet.update({
                            where: { id: chunkSetId },
                            data: { status: "INDEXED" },
                        });

                        root.update({ output: { status: "READY", pointCount: points.length } });
                    } catch (e: any) {
                        console.error(`[embedder] Failed chunkSetId="${chunkSetId}":`, e);
                        await prismaClient.document.update({
                            where: { id: documentId },
                            data: { status: "FAILED" },
                        });
                        root.update({ level: "ERROR", statusMessage: e instanceof Error ? e.message : String(e) });
                    }
                }
            );
        },
        { asType: "chain" }
    );
}

export async function embedderLoop() {
    console.log(`[embedder] Started — listening on "${EMBED_STREAM}"`);

    while (true) {
        const msg = await xReadGroupFromStream(EMBED_STREAM, EMBED_GROUP, WORKER_ID, 1, 5000);
        if (!msg) continue;

        const chunkSetId = msg.message.chunkSetId as string;
        console.log(`[embedder] Received chunkSetId="${chunkSetId}"`);

        try {
            await embedChunkSet(chunkSetId);
            await xAckOnStream(EMBED_STREAM, EMBED_GROUP, msg.id);
            console.log("======== EMBEDDER DONE =========");
        } catch (e) {
            console.error(`[embedder] Error for chunkSetId="${chunkSetId}":`, e);
        }
    }
}

if (import.meta.path === Bun.main) {
    await ensureStreams();
    await Promise.all([
        embedderLoop(),
        startClaimLoop({
            stream: EMBED_STREAM,
            group: EMBED_GROUP,
            workerId: WORKER_ID,
            dlqStream: DLQ_STREAM,
            idleThresholdMs: IDLE_THRESHOLD_MS,
            maxRetries: MAX_RETRIES,
            processFn: async (p) => embedChunkSet(p.chunkSetId as string),
            onMaxRetries: async (p) => {
                const chunkSetId = p.chunkSetId;
                const chunkSet = await prismaClient.parsedChunkSet.findUnique({
                    where: { id: chunkSetId },
                    select: { documentId: true },
                });
                const docId = chunkSet?.documentId;
                if (docId) {
                    await prismaClient.document.update({
                        where: { id: docId },
                        data: { status: "FAILED" },
                    });
                }
            },
        }, CLAIM_INTERVAL_MS),
    ]);
}
