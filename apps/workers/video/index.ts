import dotenv from "dotenv";
dotenv.config();

import { ensureStream, xReadGroupFromStream, xAckOnStream, xAddToStream } from "@repo/redis-stream/client";
import { prismaClient } from "@repo/prisma/client";
import { startClaimLoop } from "../common/claimStaleJobs.ts";

const VIDEO_STREAM = process.env.VIDEO_STREAM as string;
const VIDEO_GROUP = process.env.VIDEO_GROUP as string;
const SCENE_STREAM = process.env.SCENE_STREAM as string;
const DLQ_STREAM = process.env.DLQ_STREAM as string;
const WORKER_ID = process.env.WORKER_ID as string;

const MAX_RETRIES = 5;
const IDLE_THRESHOLD_MS = 30 * 60 * 1000;
const CLAIM_INTERVAL_MS = 30 * 1000;

// Placeholder — Phase 2: scene detection → keyframe extraction → scene_stream
async function processVideo(docId: string) {
    console.log(`[video-worker] Processing docId="${docId}"`);

    const doc = await prismaClient.document.findUnique({
        where: { id: docId },
        select: { ObjectKey: true, id: true },
    });
    if (!doc) return;

    await prismaClient.document.update({
        where: { id: docId },
        data: { status: "PARSING" },
    });

    // TODO: Phase 2 — scene detection → push scenes to scene_stream
    // For now, push a single placeholder scene
    await xAddToStream(SCENE_STREAM, { docId, sceneIndex: "0" });
    console.log(`[video-worker] Pushed placeholder scene for docId="${docId}" to scene_stream`);

    await prismaClient.document.update({
        where: { id: docId },
        data: { status: "PARSED" },
    });
}

async function videoWorkerLoop() {
    console.log(`[video-worker] Started — listening on "${VIDEO_STREAM}"`);
    while (true) {
        const msg = await xReadGroupFromStream(VIDEO_STREAM, VIDEO_GROUP, WORKER_ID, 1, 5000);
        if (!msg) continue;
        const docId = msg.message.docId as string;
        try {
            await processVideo(docId);
            await xAckOnStream(VIDEO_STREAM, VIDEO_GROUP, msg.id);
        } catch (e) {
            console.error(`[video-worker] Error docId="${docId}":`, e);
        }
    }
}

await ensureStream(VIDEO_STREAM, VIDEO_GROUP);
await Promise.all([
    videoWorkerLoop(),
    startClaimLoop({
        stream: VIDEO_STREAM,
        group: VIDEO_GROUP,
        workerId: WORKER_ID,
        dlqStream: DLQ_STREAM,
        idleThresholdMs: IDLE_THRESHOLD_MS,
        maxRetries: MAX_RETRIES,
        processFn: async (p) => processVideo(p.docId as string),
    }, CLAIM_INTERVAL_MS),
]);
