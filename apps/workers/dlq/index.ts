import dotenv from "dotenv";
dotenv.config();

import { xReadGroupFromStream, xAckOnStream } from "@repo/redis-stream/client";
import { prismaClient } from "@repo/prisma/client";

const DLQ_STREAM = process.env.DLQ_STREAM as string;
const DLQ_GROUP = process.env.DLQ_GROUP as string;
const WORKER_ID = process.env.WORKER_ID as string;

export async function processDlqMessage(docId: string) {
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

        // Already retried by claimStaleJobs() — mark permanently failed
        await prismaClient.document.update({
            where: { id: docId },
            data: { status: "FAILED" },
        });
    } catch (e) {
        console.error(`[dlq] Error processing docId="${docId}":`, e);
    }
}

export async function dlqLoop() {
    console.log(`[dlq] Started — listening on "${DLQ_STREAM}"`);

    while (true) {
        const msg = await xReadGroupFromStream(DLQ_STREAM, DLQ_GROUP, WORKER_ID, 1, 5000);
        if (!msg) continue;

        const docId = msg.message.docId as string;
        console.log(`[dlq] Received docId="${docId}"`);

        try {
            await processDlqMessage(docId);
            await xAckOnStream(DLQ_STREAM, DLQ_GROUP, msg.id);
        } catch (e) {
            console.error(`[dlq] Error:`, e);
        }
    }
}


