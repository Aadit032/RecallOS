import dotenv from "dotenv";
dotenv.config();

import { initTracing } from "@repo/langfuse/client";
initTracing({ serviceName: "dispatcher-worker" });

import { ensureStream, xReadGroupFromStream, xAckOnStream, xAddToStream } from "@repo/redis-stream/client";
import { prismaClient } from "@repo/prisma/client";

const FILES_STREAM = process.env.FILES_STREAM as string;
const FILES_GROUP = process.env.FILES_GROUP as string;
const PDF_STREAM = process.env.PDF_STREAM as string;
const IMAGE_STREAM = process.env.IMAGE_STREAM as string;
const AUDIO_STREAM = process.env.AUDIO_STREAM as string;
const VIDEO_STREAM = process.env.VIDEO_STREAM as string;

const WORKER_ID = process.env.WORKER_ID as string;

const modalityStreams: Record<string, string> = {
    "application/pdf": PDF_STREAM,
    "image/png": IMAGE_STREAM,
    "image/jpeg": IMAGE_STREAM,
    "image/webp": IMAGE_STREAM,
    "image/gif": IMAGE_STREAM,
    "image/tiff": IMAGE_STREAM,
    "audio/mpeg": AUDIO_STREAM,
    "audio/mp3": AUDIO_STREAM,
    "audio/wav": AUDIO_STREAM,
    "audio/ogg": AUDIO_STREAM,
    "video/mp4": VIDEO_STREAM,
    "video/webm": VIDEO_STREAM,
    "video/ogg": VIDEO_STREAM,
};

function getModality(mimeType: string): string {
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("audio/")) return "audio";
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType === "application/pdf") return "pdf";
    return "unknown";
}

export async function ensureAllStreams() {
    const groups = [
        { stream: FILES_STREAM, group: FILES_GROUP },
        { stream: PDF_STREAM, group: process.env.PDF_GROUP! },
        { stream: IMAGE_STREAM, group: process.env.IMAGE_GROUP! },
        { stream: AUDIO_STREAM, group: process.env.AUDIO_GROUP! },
        { stream: VIDEO_STREAM, group: process.env.VIDEO_GROUP! },
        { stream: process.env.SCENE_STREAM!, group: process.env.SCENE_GROUP! },
        { stream: process.env.EMBED_STREAM!, group: process.env.EMBED_GROUP! },
        { stream: process.env.DLQ_STREAM!, group: process.env.DLQ_GROUP! },
    ];
    for (const { stream, group } of groups) {
        await ensureStream(stream, group);
    }
}

export async function routeDocument(docId: string) {
    const doc = await prismaClient.document.findUnique({
        where: { id: docId },
        select: { mimeType: true, id: true },
    });

    if (!doc) {
        console.log(`[dispatcher] Document ${docId} not found — skipping`);
        return;
    }

    const mimeType = doc.mimeType;
    const targetStream = modalityStreams[mimeType];

    if (!targetStream) {
        console.log(`[dispatcher] No route for mimeType="${mimeType}" — marking FAILED`);
        await prismaClient.document.update({
            where: { id: docId },
            data: { status: "FAILED" },
        });
        return;
    }

    const modality = getModality(mimeType);
    console.log(`[dispatcher] Routing docId="${docId}" (${mimeType}) → "${targetStream}"`);

    await prismaClient.document.update({
        where: { id: docId },
        data: { status: "QUEUED", modality },
    });

    await xAddToStream(targetStream, { docId });
    console.log(`[dispatcher] Routed docId="${docId}" to ${targetStream}`);
}

export async function dispatcherLoop() {
    console.log(`[dispatcher] Started — listening on "${FILES_STREAM}"`);

    while (true) {
        const msg = await xReadGroupFromStream(FILES_STREAM, FILES_GROUP, WORKER_ID, 1, 5000);
        if (!msg) continue;

        const docId = msg.message.docId as string;
        console.log(`[dispatcher] Received docId="${docId}"`);

        try {
            await routeDocument(docId);
            await xAckOnStream(FILES_STREAM, FILES_GROUP, msg.id);
        } catch (e) {
            console.error(`[dispatcher] Error processing docId="${docId}":`, e);
        }
    }
}


