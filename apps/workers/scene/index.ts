import dotenv from "dotenv";
dotenv.config();

import { ensureStream, xReadGroupFromStream, xAckOnStream, xAddToStream } from "@repo/redis-stream/client";
import { prismaClient } from "@repo/prisma/client";

const SCENE_STREAM = process.env.SCENE_STREAM as string;
const SCENE_GROUP = process.env.SCENE_GROUP as string;
const EMBED_STREAM = process.env.EMBED_STREAM as string;
const WORKER_ID = process.env.WORKER_ID as string;

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
        const docId = msg.message.docId;
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
await sceneWorkerLoop();
