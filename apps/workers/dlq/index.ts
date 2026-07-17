import dotenv from "dotenv";
dotenv.config();

import { ensureStream, xReadGroupFromStream, xAckOnStream, xAddToStream } from "@repo/redis-stream/client";
import { prismaClient } from "@repo/prisma/client";

const DLQ_STREAM = process.env.DLQ_STREAM as string;
const DLQ_GROUP = process.env.DLQ_GROUP as string;
const FILES_STREAM = process.env.FILES_STREAM as string;
const WORKER_ID = process.env.WORKER_ID as string;

async function ensureStreams() {
    await ensureStream(DLQ_STREAM, DLQ_GROUP);
}

async function processDlqMessage(docId: string) {
    console.log(`[dlq] Processing DLQ entry for docId="${docId}"`);

    try {
        const doc = await prismaClient.document.findUnique({
            where: { id: docId },
            select: { id: true, status: true },
        });

        if (!doc) {
            console.log(`[dlq] Document ${docId} already deleted — acking`);
            return;
        }

        // Re-route back to files_stream for one more attempt
        await xAddToStream(FILES_STREAM, { docId });
        console.log(`[dlq] Re-routed docId="${docId}" to files_stream for retry`);

        // If it's already been to DLQ before, mark FAILED permanently
        await prismaClient.document.update({
            where: { id: docId },
            data: { status: "FAILED" },
        });
    } catch (e) {
        console.error(`[dlq] Error processing docId="${docId}":`, e);
    }
}

async function dlqLoop() {
    console.log(`[dlq] Started — listening on "${DLQ_STREAM}"`);

    while (true) {
        const msg = await xReadGroupFromStream(DLQ_STREAM, DLQ_GROUP, WORKER_ID, 1, 5000);
        if (!msg) continue;

        const docId = msg.message.docId;
        console.log(`[dlq] Received docId="${docId}"`);

        try {
            await processDlqMessage(docId);
            await xAckOnStream(DLQ_STREAM, DLQ_GROUP, msg.id);
        } catch (e) {
            console.error(`[dlq] Error:`, e);
        }
    }
}

await ensureStreams();
await dlqLoop();
