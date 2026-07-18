import dotenv from "dotenv";
dotenv.config();

import { ensureStream, xReadGroupFromStream, xAckOnStream, xAddToStream } from "@repo/redis-stream/client";
import { prismaClient } from "@repo/prisma/client";
import { startClaimLoop } from "../common/claimStaleJobs.ts";

const SCENE_STREAM = process.env.SCENE_STREAM as string;
const SCENE_GROUP = process.env.SCENE_GROUP as string;
const EMBED_STREAM = process.env.EMBED_STREAM as string;
const DLQ_STREAM = process.env.DLQ_STREAM as string;
const WORKER_ID = process.env.WORKER_ID as string;

const MAX_RETRIES = 5;
const IDLE_THRESHOLD_MS = 30 * 60 * 1000;
const CLAIM_INTERVAL_MS = 30 * 1000;

// Placeholder — Phase 2: keyframe → OCR → vision → transcript → ParsedChunkSet
async function processScene(docId: string, sceneIndex: string) {
    console.log(`[scene-worker] Processing docId="${docId}", sceneIndex="${sceneIndex}"`);

    // TODO: Phase 2 — keyframe extraction → OCR → vision model → transcript → ParsedChunkSet
    const chunkSet = await prismaClient.parsedChunkSet.create({
        data: {
            documentId: docId,
            modality: "video",
            status: "PARSED",
            chunks: {
                create: [
                    {
                        text: `[Scene worker] Placeholder for docId="${docId}" sceneIndex="${sceneIndex}"`,
                        metadata: { sceneIndex, timestampStart: null, timestampEnd: null },
                    },
                ],
            },
        },
    });

    await xAddToStream(EMBED_STREAM, { chunkSetId: chunkSet.id });
    console.log(`[scene-worker] Pushed chunkSetId="${chunkSet.id}" to embed_stream`);
}

async function sceneWorkerLoop() {
    console.log(`[scene-worker] Started — listening on "${SCENE_STREAM}"`);
    while (true) {
        const msg = await xReadGroupFromStream(SCENE_STREAM, SCENE_GROUP, WORKER_ID, 1, 5000);
        if (!msg) continue;
        const docId = msg.message.docId as string;
        const sceneIndex = msg.message.sceneIndex ?? "0";
        try {
            await processScene(docId, sceneIndex);
            await xAckOnStream(SCENE_STREAM, SCENE_GROUP, msg.id);
        } catch (e) {
            console.error(`[scene-worker] Error docId="${docId}":`, e);
        }
    }
}

await ensureStream(SCENE_STREAM, SCENE_GROUP);
await Promise.all([
    sceneWorkerLoop(),
    startClaimLoop({
        stream: SCENE_STREAM,
        group: SCENE_GROUP,
        workerId: WORKER_ID,
        dlqStream: DLQ_STREAM,
        idleThresholdMs: IDLE_THRESHOLD_MS,
        maxRetries: MAX_RETRIES,
        processFn: async (p) => processScene(p.docId as string, p.sceneIndex ?? "0"),
    }, CLAIM_INTERVAL_MS),
]);
