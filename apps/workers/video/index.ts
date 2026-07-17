import dotenv from "dotenv";
dotenv.config();

import { ensureStream, xReadGroupFromStream, xAckOnStream, xAddToStream } from "@repo/redis-stream/client";
import { prismaClient } from "@repo/prisma/client";

const VIDEO_STREAM = process.env.VIDEO_STREAM as string;
const VIDEO_GROUP = process.env.VIDEO_GROUP as string;
const SCENE_STREAM = process.env.SCENE_STREAM as string;
const WORKER_ID = process.env.WORKER_ID as string;

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
        const docId = msg.message.docId;
        try {
            await processVideo(docId);
            await xAckOnStream(VIDEO_STREAM, VIDEO_GROUP, msg.id);
        } catch (e) {
            console.error(`[video-worker] Error docId="${docId}":`, e);
        }
    }
}

await ensureStream(VIDEO_STREAM, VIDEO_GROUP);
await videoWorkerLoop();
