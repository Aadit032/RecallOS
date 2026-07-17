import dotenv from "dotenv";
dotenv.config();

import { ensureStream, xReadGroupFromStream, xAckOnStream, xAddToStream, xAutoClaimOnStream } from "@repo/redis-stream/client";
import { prismaClient } from "@repo/prisma/client";
import { downloadToDisk } from "../common/download.ts";

const IMAGE_STREAM = process.env.IMAGE_STREAM as string;
const IMAGE_GROUP = process.env.IMAGE_GROUP as string;
const EMBED_STREAM = process.env.EMBED_STREAM as string;
const WORKER_ID = process.env.WORKER_ID as string;
const MODEL = process.env.VISION_MODEL ?? "openai/gpt-4o-mini";

// Placeholder — will wire vision model + OCR in Phase 2
async function processImage(docId: string) {
    console.log(`[image-worker] Processing docId="${docId}"`);

    const doc = await prismaClient.document.findUnique({
        where: { id: docId },
        select: { ObjectKey: true, id: true },
    });
    if (!doc) return;

    await prismaClient.document.update({
        where: { id: docId },
        data: { status: "PARSING" },
    });

    // TODO: Phase 2 — Download image → vision model → OCR → ParsedChunkSet
    const chunkSet = await prismaClient.parsedChunkSet.create({
        data: {
            documentId: docId,
            modality: "image",
            status: "PARSED",
            chunks: {
                create: [
                    {
                        text: `[Image worker] Placeholder for image ${doc.ObjectKey}`,
                        metadata: { page: null, caption: null, ocr: null },
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
    console.log(`[image-worker] Pushed chunkSetId="${chunkSet.id}" to embed_stream`);
}

async function imageWorkerLoop() {
    console.log(`[image-worker] Started — listening on "${IMAGE_STREAM}"`);
    while (true) {
        const msg = await xReadGroupFromStream(IMAGE_STREAM, IMAGE_GROUP, WORKER_ID, 1, 5000);
        if (!msg) continue;
        const docId = msg.message.docId;
        try {
            await processImage(docId);
            await xAckOnStream(IMAGE_STREAM, IMAGE_GROUP, msg.id);
        } catch (e) {
            console.error(`[image-worker] Error docId="${docId}":`, e);
        }
    }
}

await ensureStream(IMAGE_STREAM, IMAGE_GROUP);
await imageWorkerLoop();
