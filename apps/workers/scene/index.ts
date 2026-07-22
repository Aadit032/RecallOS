import dotenv from "dotenv";
dotenv.config();

import { ensureStream, xReadGroupFromStream, xAckOnStream, xAddToStream } from "@repo/redis-stream/client";
import { prismaClient } from "@repo/prisma/client";
import { startClaimLoop } from "../common/claimStaleJobs.ts";
import { downloadToDisk } from "../common/download.ts";
import { extractAudioClip, extractKeyframe } from "../common/ffmpeg.ts";
import { cleanupTemp, extFromKey, fileToDataUrl, makeTempDir } from "../common/temp.ts";
import { transcribeAudioFile } from "../common/transcribe.ts";
import { describeImage } from "../common/vision.ts";
import path from "path";

const SCENE_STREAM = process.env.SCENE_STREAM as string;
const SCENE_GROUP = process.env.SCENE_GROUP as string;
const EMBED_STREAM = process.env.EMBED_STREAM as string;
const DLQ_STREAM = process.env.DLQ_STREAM as string;
const WORKER_ID = process.env.WORKER_ID as string;

const MAX_RETRIES = 5;
const IDLE_THRESHOLD_MS = 30 * 60 * 1000;
const CLAIM_INTERVAL_MS = 30 * 1000;

export type SceneJob = {
    docId: string;
    sceneIndex: string;
    timestampStart?: string;
    timestampEnd?: string;
};

/**
 * Process one video scene: keyframe → vision/OCR → optional clip transcript → ParsedChunkSet.
 */
export async function processScene(
    docId: string,
    sceneIndex: string,
    timestampStart?: string,
    timestampEnd?: string
) {
    console.log(
        `[scene-worker] Processing docId="${docId}", sceneIndex="${sceneIndex}", ` +
            `t=[${timestampStart ?? "?"}, ${timestampEnd ?? "?"}]`
    );

    const doc = await prismaClient.document.findUnique({
        where: { id: docId },
        select: { ObjectKey: true, id: true },
    });
    if (!doc) {
        console.log(`[scene-worker] Document ${docId} not found — skipping`);
        return;
    }

    const start = parseFloat(timestampStart ?? "0");
    const end = parseFloat(timestampEnd ?? "0");
    const hasRange = Number.isFinite(start) && Number.isFinite(end) && end > start;

    const tmpDir = makeTempDir("recallos-scene-");
    try {
        const ext = extFromKey(doc.ObjectKey, "mp4");
        const localVideo = path.join(tmpDir, `video.${ext}`);
        await downloadToDisk(doc.ObjectKey, localVideo);

        const sceneStart = hasRange ? start : 0;
        // If range missing, sample near start of file (~1s window for keyframe midpoint)
        const sceneEnd = hasRange ? end : Math.max(sceneStart + 2, 2);

        const keyframePath = path.join(tmpDir, "keyframe.jpg");
        await extractKeyframe(localVideo, sceneStart, sceneEnd, keyframePath);
        const vision = await describeImage(fileToDataUrl(keyframePath, "image/jpeg"));
        console.log(
            `[scene-worker] Vision — caption=${vision.caption.length}c ocr=${vision.ocr.length}c`
        );

        let transcriptText = "";
        try {
            const audioPath = await extractAudioClip(localVideo, sceneStart, sceneEnd, tmpDir);
            if (audioPath) {
                const transcript = await transcribeAudioFile(audioPath);
                transcriptText = transcript.text.trim();
                console.log(`[scene-worker] Transcript: ${transcriptText.length} chars`);
            } else {
                console.log(`[scene-worker] No audio clip for this scene`);
            }
        } catch (e) {
            // Audio is optional for retrieval quality; vision still useful
            console.warn(`[scene-worker] Transcript failed (continuing with vision only):`, e);
        }

        const textParts: string[] = [];
        if (vision.caption) textParts.push(vision.caption);
        if (vision.ocr) textParts.push(`On-screen text:\n${vision.ocr}`);
        if (transcriptText) textParts.push(`Spoken audio:\n${transcriptText}`);
        const text = textParts.join("\n\n").trim();

        if (!text) {
            throw new Error(
                `Empty scene content for docId=${docId} sceneIndex=${sceneIndex}`
            );
        }

        const chunkSet = await prismaClient.parsedChunkSet.create({
            data: {
                documentId: docId,
                modality: "video",
                status: "PARSED",
                chunks: {
                    create: [
                        {
                            text,
                            metadata: {
                                sceneIndex: Number.isFinite(Number(sceneIndex))
                                    ? Number(sceneIndex)
                                    : sceneIndex,
                                timestampStart: hasRange ? sceneStart : null,
                                timestampEnd: hasRange ? sceneEnd : null,
                                caption: vision.caption || null,
                                ocr: vision.ocr || null,
                                transcript: transcriptText || null,
                            },
                        },
                    ],
                },
            },
        });

        await xAddToStream(EMBED_STREAM, { chunkSetId: chunkSet.id });
        console.log(`[scene-worker] Pushed chunkSetId="${chunkSet.id}" to embed_stream`);
    } catch (e) {
        console.error(
            `[scene-worker] Failed docId="${docId}" sceneIndex="${sceneIndex}":`,
            e
        );
        // Don't mark whole document FAILED on one scene — rethrow for PEL/retry.
        // After max retries claim loop DLQs with docId.
        throw e;
    } finally {
        cleanupTemp(tmpDir);
    }
}

export async function sceneWorkerLoop() {
    console.log(`[scene-worker] Started — listening on "${SCENE_STREAM}"`);
    while (true) {
        const msg = await xReadGroupFromStream(SCENE_STREAM, SCENE_GROUP, WORKER_ID, 1, 5000);
        if (!msg) continue;
        const docId = msg.message.docId as string;
        const sceneIndex = msg.message.sceneIndex ?? "0";
        const timestampStart = msg.message.timestampStart;
        const timestampEnd = msg.message.timestampEnd;
        try {
            await processScene(docId, sceneIndex, timestampStart, timestampEnd);
            await xAckOnStream(SCENE_STREAM, SCENE_GROUP, msg.id);
        } catch (e) {
            console.error(`[scene-worker] Error docId="${docId}":`, e);
        }
    }
}

if (import.meta.path === Bun.main) {
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
            processFn: async (p) =>
                processScene(
                    p.docId as string,
                    p.sceneIndex ?? "0",
                    p.timestampStart,
                    p.timestampEnd
                ),
        }, CLAIM_INTERVAL_MS),
    ]);
}
