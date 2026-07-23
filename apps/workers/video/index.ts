import dotenv from "dotenv";
dotenv.config();

import { xReadGroupFromStream, xAckOnStream, xAddToStream } from "@repo/redis-stream/client";
import { prismaClient } from "@repo/prisma/client";
import { downloadToDisk } from "../common/download.ts";
import { detectScenes } from "../common/ffmpeg.ts";
import { cleanupTemp, extFromKey, makeTempDir } from "../common/temp.ts";
import path from "path";

const VIDEO_STREAM = process.env.VIDEO_STREAM as string;
const VIDEO_GROUP = process.env.VIDEO_GROUP as string;
const SCENE_STREAM = process.env.SCENE_STREAM as string;
const DLQ_STREAM = process.env.DLQ_STREAM as string;
const WORKER_ID = process.env.WORKER_ID as string;

/**
 * Video workers only split videos into scenes and enqueue each scene.
 * Scene workers handle keyframe / OCR / vision / transcript.
 */
export async function processVideo(docId: string) {
    console.log(`[video-worker] Processing docId="${docId}"`);

    const doc = await prismaClient.document.findUnique({
        where: { id: docId },
        select: { ObjectKey: true, id: true },
    });
    if (!doc) {
        console.log(`[video-worker] Document ${docId} not found — skipping`);
        return;
    }

    await prismaClient.document.update({
        where: { id: docId },
        data: { status: "PARSING" },
    });

    const tmpDir = makeTempDir("recallos-video-");
    try {
        const ext = extFromKey(doc.ObjectKey, "mp4");
        const localPath = path.join(tmpDir, `video.${ext}`);
        await downloadToDisk(doc.ObjectKey, localPath);
        console.log(`[video-worker] Downloaded ${doc.ObjectKey} → ${localPath}`);

        const scenes = await detectScenes(localPath);
        console.log(`[video-worker] Detected ${scenes.length} scene(s)`);

        for (const scene of scenes) {
            await xAddToStream(SCENE_STREAM, {
                docId,
                sceneIndex: String(scene.index),
                timestampStart: String(scene.start),
                timestampEnd: String(scene.end),
            });
        }
        console.log(
            `[video-worker] Pushed ${scenes.length} scene(s) for docId="${docId}" to scene_stream`
        );

        // Split complete — scene workers produce ParsedChunkSets asynchronously.
        await prismaClient.document.update({
            where: { id: docId },
            data: { status: "PARSED" },
        });
    } catch (e) {
        console.error(`[video-worker] Failed docId="${docId}":`, e);
        try {
            await prismaClient.document.update({
                where: { id: docId },
                data: { status: "FAILED" },
            });
        } catch {
            /* ignore */
        }
        await xAddToStream(DLQ_STREAM, { docId });
        // Swallow after DLQ so the stream message can be ACKed (matches pdf worker).
    } finally {
        cleanupTemp(tmpDir);
    }
}

export async function videoWorkerLoop() {
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


