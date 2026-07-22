import LlamaCloud from '@llamaindex/llama-cloud';
import dotenv from "dotenv";
import { initTracing } from "@repo/langfuse/client";
import { dispatcherLoop, routeDocument, ensureAllStreams } from "./dispatcher/index.ts";
import { pdfWorkerLoop, processPdfDocument } from "./pdf/index.ts";
import { imageWorkerLoop, processImage } from "./image/index.ts";
import { audioWorkerLoop, processAudio } from "./audio/index.ts";
import { videoWorkerLoop, processVideo } from "./video/index.ts";
import { sceneWorkerLoop, processScene } from "./scene/index.ts";
import { embedderLoop, embedChunkSet } from "./embedder/index.ts";
import { dlqLoop, processDlqMessage } from "./dlq/index.ts";
import { prismaClient } from "@repo/prisma/client";
import { startClaimLoop } from "./common/claimStaleJobs.ts";
dotenv.config();

initTracing({ serviceName: "recall-os-workers" });

export const llamaClient = new LlamaCloud({ apiKey: process.env['LLAMA_CLOUD_API_KEY'] });
export type Tier = "fast" | "cost_effective" | "agentic" | "agentic_plus";

console.log("[workers:runner] Starting all workers in a single process");


const FILES_STREAM = process.env.FILES_STREAM as string;
const FILES_GROUP = process.env.FILES_GROUP as string;
const PDF_STREAM = process.env.PDF_STREAM as string;
const PDF_GROUP = process.env.PDF_GROUP as string;
const IMAGE_STREAM = process.env.IMAGE_STREAM as string;
const IMAGE_GROUP = process.env.IMAGE_GROUP as string;
const AUDIO_STREAM = process.env.AUDIO_STREAM as string;
const AUDIO_GROUP = process.env.AUDIO_GROUP as string;
const VIDEO_STREAM = process.env.VIDEO_STREAM as string;
const VIDEO_GROUP = process.env.VIDEO_GROUP as string;
const SCENE_STREAM = process.env.SCENE_STREAM as string;
const SCENE_GROUP = process.env.SCENE_GROUP as string;
const EMBED_STREAM = process.env.EMBED_STREAM as string;
const EMBED_GROUP = process.env.EMBED_GROUP as string;
const DLQ_STREAM = process.env.DLQ_STREAM as string;
// const DLQ_GROUP = process.env.DLQ_GROUP as string;

const WORKER_ID = process.env.WORKER_ID as string;

const IDLE_THRESHOLD_MS = 30 * 60 * 1000;
const CLAIM_INTERVAL_MS = 30 * 1000;

async function main() {
    console.log("[runner] Ensuring all streams exist...");
    await ensureAllStreams();

    console.log("[runner] Starting all worker loops...");

    await Promise.all([
        dispatcherLoop(),
        startClaimLoop({
            stream: FILES_STREAM,
            group: FILES_GROUP,
            workerId: WORKER_ID,
            dlqStream: DLQ_STREAM,
            idleThresholdMs: IDLE_THRESHOLD_MS,
            maxRetries: 5,
            processFn: async (p) => routeDocument(p.docId!),
        }, CLAIM_INTERVAL_MS),

        pdfWorkerLoop(),
        startClaimLoop({
            stream: PDF_STREAM,
            group: PDF_GROUP,
            workerId: WORKER_ID,
            dlqStream: DLQ_STREAM,
            idleThresholdMs: IDLE_THRESHOLD_MS,
            maxRetries: 10,
            processFn: async (p) => processPdfDocument(p.docId!, "basic"),
        }, CLAIM_INTERVAL_MS),

        imageWorkerLoop(),
        startClaimLoop({
            stream: IMAGE_STREAM,
            group: IMAGE_GROUP,
            workerId: WORKER_ID,
            dlqStream: DLQ_STREAM,
            idleThresholdMs: IDLE_THRESHOLD_MS,
            maxRetries: 5,
            processFn: async (p) => processImage(p.docId!),
        }, CLAIM_INTERVAL_MS),

        audioWorkerLoop(),
        startClaimLoop({
            stream: AUDIO_STREAM,
            group: AUDIO_GROUP,
            workerId: WORKER_ID,
            dlqStream: DLQ_STREAM,
            idleThresholdMs: IDLE_THRESHOLD_MS,
            maxRetries: 5,
            processFn: async (p) => processAudio(p.docId!),
        }, CLAIM_INTERVAL_MS),

        videoWorkerLoop(),
        startClaimLoop({
            stream: VIDEO_STREAM,
            group: VIDEO_GROUP,
            workerId: WORKER_ID,
            dlqStream: DLQ_STREAM,
            idleThresholdMs: IDLE_THRESHOLD_MS,
            maxRetries: 5,
            processFn: async (p) => processVideo(p.docId!),
        }, CLAIM_INTERVAL_MS),

        sceneWorkerLoop(),
        startClaimLoop({
            stream: SCENE_STREAM,
            group: SCENE_GROUP,
            workerId: WORKER_ID,
            dlqStream: DLQ_STREAM,
            idleThresholdMs: IDLE_THRESHOLD_MS,
            maxRetries: 5,
            processFn: async (p) =>
                processScene(
                    p.docId!,
                    p.sceneIndex ?? "0",
                    p.timestampStart,
                    p.timestampEnd
                ),
        }, CLAIM_INTERVAL_MS),

        embedderLoop(),
        startClaimLoop({
            stream: EMBED_STREAM,
            group: EMBED_GROUP,
            workerId: WORKER_ID,
            dlqStream: DLQ_STREAM,
            idleThresholdMs: IDLE_THRESHOLD_MS,
            maxRetries: 5,
            processFn: async (p) => embedChunkSet(p.chunkSetId!),
            onMaxRetries: async (p) => {
                const chunkSetId = p.chunkSetId;
                const chunkSet = await prismaClient.parsedChunkSet.findUnique({
                    where: { id: chunkSetId },
                    select: { documentId: true },
                });
                const docId = chunkSet?.documentId;
                if (docId) {
                    await prismaClient.document.update({
                        where: { id: docId },
                        data: { status: "FAILED" },
                    });
                }
            },
        }, CLAIM_INTERVAL_MS),

        dlqLoop(),
    ]);
}

await main();
