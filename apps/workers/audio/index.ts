import dotenv from "dotenv";
dotenv.config();

import { ensureStream, xReadGroupFromStream, xAckOnStream, xAddToStream } from "@repo/redis-stream/client";
import { prismaClient } from "@repo/prisma/client";
import { startClaimLoop } from "../common/claimStaleJobs.ts";
import { downloadToDisk } from "../common/download.ts";
import { cleanupTemp, extFromKey, makeTempDir } from "../common/temp.ts";
import { chunkTranscript, transcribeAudioFile } from "../common/transcribe.ts";
import path from "path";

const AUDIO_STREAM = process.env.AUDIO_STREAM as string;
const AUDIO_GROUP = process.env.AUDIO_GROUP as string;
const EMBED_STREAM = process.env.EMBED_STREAM as string;
const DLQ_STREAM = process.env.DLQ_STREAM as string;
const WORKER_ID = process.env.WORKER_ID as string;

const MAX_RETRIES = 5;
const IDLE_THRESHOLD_MS = 30 * 60 * 1000;
const CLAIM_INTERVAL_MS = 30 * 1000;

export async function processAudio(docId: string) {
    console.log(`[audio-worker] Processing docId="${docId}"`);

    const doc = await prismaClient.document.findUnique({
        where: { id: docId },
        select: { ObjectKey: true, id: true },
    });
    if (!doc) {
        console.log(`[audio-worker] Document ${docId} not found — skipping`);
        return;
    }

    await prismaClient.document.update({
        where: { id: docId },
        data: { status: "PARSING" },
    });

    const tmpDir = makeTempDir("recallos-audio-");
    try {
        const ext = extFromKey(doc.ObjectKey, "mp3");
        const localPath = path.join(tmpDir, `audio.${ext}`);
        await downloadToDisk(doc.ObjectKey, localPath);
        console.log(`[audio-worker] Downloaded ${doc.ObjectKey} → ${localPath}`);

        const transcript = await transcribeAudioFile(localPath);
        console.log(`[audio-worker] Transcript: ${transcript.text.length} chars, ${transcript.segments.length} segments`);

        if (!transcript.text.trim()) throw new Error("Whisper returned empty transcript");

        const timedChunks = chunkTranscript(transcript);
        console.log(`[audio-worker] Chunks: ${timedChunks.length}`);

        const chunkSet = await prismaClient.parsedChunkSet.create({
            data: {
                documentId: docId,
                modality: "audio",
                status: "PARSED",
                chunks: {
                    create: timedChunks.map((c, i) => ({
                        text: c.text,
                        metadata: {
                            chunkIndex: i,
                            timestampStart: c.timestampStart,
                            timestampEnd: c.timestampEnd,
                            language: transcript.language ?? null,
                            duration: transcript.duration ?? null,
                        },
                    })),
                },
            },
        });

        await prismaClient.document.update({
            where: { id: docId },
            data: { status: "PARSED" },
        });

        await xAddToStream(EMBED_STREAM, { chunkSetId: chunkSet.id });
        console.log(`[audio-worker] Pushed chunkSetId="${chunkSet.id}" to embed_stream`);
    } catch (e) {
        console.error(`[audio-worker] Failed docId="${docId}":`, e);
        try {
            await prismaClient.document.update({
                where: { id: docId },
                data: { status: "FAILED" },
            });
        } catch {
            /* ignore */
            console.error(`[audio-worker] Failed to mark docId="${docId}" as FAILED`);
        }
        await xAddToStream(DLQ_STREAM, { docId });
    } finally {
        cleanupTemp(tmpDir);
    }
}

export async function audioWorkerLoop() {
    console.log(`[audio-worker] Started — listening on "${AUDIO_STREAM}"`);
    while (true) {
        const msg = await xReadGroupFromStream(AUDIO_STREAM, AUDIO_GROUP, WORKER_ID, 1, 5000);
        if (!msg) continue;
        const docId = msg.message.docId as string;
        try {
            await processAudio(docId);
            await xAckOnStream(AUDIO_STREAM, AUDIO_GROUP, msg.id);
        } catch (e) {
            console.error(`[audio-worker] Error docId="${docId}":`, e);
        }
    }
}

if (import.meta.path === Bun.main) {
    await ensureStream(AUDIO_STREAM, AUDIO_GROUP);
    await Promise.all([
        audioWorkerLoop(),
        startClaimLoop({
            stream: AUDIO_STREAM,
            group: AUDIO_GROUP,
            workerId: WORKER_ID,
            dlqStream: DLQ_STREAM,
            idleThresholdMs: IDLE_THRESHOLD_MS,
            maxRetries: MAX_RETRIES,
            processFn: async (p) => processAudio(p.docId as string),
        }, CLAIM_INTERVAL_MS),
    ]);
}
