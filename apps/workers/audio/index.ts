import dotenv from "dotenv";
dotenv.config();

import { ensureStream, xReadGroupFromStream, xAckOnStream, xAddToStream } from "@repo/redis-stream/client";
import { prismaClient } from "@repo/prisma/client";

const AUDIO_STREAM = process.env.AUDIO_STREAM as string;
const AUDIO_GROUP = process.env.AUDIO_GROUP as string;
const EMBED_STREAM = process.env.EMBED_STREAM as string;
const WORKER_ID = process.env.WORKER_ID as string;

// Placeholder — will wire Whisper + semantic chunking in Phase 2
async function processAudio(docId: string) {
    console.log(`[audio-worker] Processing docId="${docId}"`);

    const doc = await prismaClient.document.findUnique({
        where: { id: docId },
        select: { ObjectKey: true, id: true },
    });
    if (!doc) return;

    await prismaClient.document.update({
        where: { id: docId },
        data: { status: "PARSING" },
    });

    // TODO: Phase 2 — Download audio → Whisper → transcript → semantic chunking
    const chunkSet = await prismaClient.parsedChunkSet.create({
        data: {
            documentId: docId,
            modality: "audio",
            status: "PARSED",
            chunks: {
                create: [
                    {
                        text: `[Audio worker] Placeholder for audio ${doc.ObjectKey}`,
                        metadata: { timestampStart: null, timestampEnd: null },
                    },
                ],
            },
        },
    });

    await prismaClient.document.update({
        where: { id: docId },
        data: { status: "PARSED" },
    });

    await xAddToStream(EMBED_STREAM, { chunkSetId: chunkSet.id });
}

async function audioWorkerLoop() {
    console.log(`[audio-worker] Started — listening on "${AUDIO_STREAM}"`);
    while (true) {
        const msg = await xReadGroupFromStream(AUDIO_STREAM, AUDIO_GROUP, WORKER_ID, 1, 5000);
        if (!msg) continue;
        const docId = msg.message.docId;
        try {
            await processAudio(docId);
            await xAckOnStream(AUDIO_STREAM, AUDIO_GROUP, msg.id);
        } catch (e) {
            console.error(`[audio-worker] Error docId="${docId}":`, e);
        }
    }
}

await ensureStream(AUDIO_STREAM, AUDIO_GROUP);
await audioWorkerLoop();
