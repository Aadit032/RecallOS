import { Router } from "express"
import { prismaClient } from "@repo/prisma/client";
import { GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3"
import { s3 } from "@repo/minio/client";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { removeDocumentFromStream, removeDocumentFromAllStreams } from "@repo/redis-stream/client";
import { qdrantClient } from "@repo/qdrant/client";
import dotenv from "dotenv"
dotenv.config();

const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME
const COLLECTION = process.env.COLLECTION as string

const downloadRouter = Router();

downloadRouter.post("/get-download-url", async (req, res) => {
    const userId = req.userId;
    const { key } = req.body;
    console.log(`[download:get-download-url] Entry — userId=${userId}, key="${key}"`);
    if (!key) {
        console.warn(`[download:get-download-url] Missing required field: ObjectKey`);
        res.status(400).json({ message: "Missing required field: ObjectKey" });
        return;
    }

    try{
        console.log(`[download:get-download-url] Verifying ownership of key="${key}"`);
        const doc = await prismaClient.document.findFirst({
            where: { ObjectKey: key, userId },
            select: { id: true }
        });
        if(!doc){
            console.warn(`[download:get-download-url] Forbidden — no document for key="${key}" owned by userId=${userId}`);
            res.status(403).json({ message: "Forbidden." })
            return;
        }
        console.log(`[download:get-download-url] Document verified: id=${doc.id}`);

        const command = new GetObjectCommand({
            Bucket: AWS_BUCKET_NAME,
            Key: key
        });

        console.log(`[download:get-download-url] Generating presigned GET URL for bucket="${AWS_BUCKET_NAME}"`);
        const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 5 * 60 });
        console.log(`[download:get-download-url] Presigned URL generated (expires in 5 min)`);

        res.status(200).json({ presignedUrl });
    }catch(e){
        console.error(`[download:get-download-url] Server error:`, e);
        res.status(500).json({ message: "Server error while getting presigned url for downloading." + e })
    }
});

downloadRouter.get("/list", async (req, res) => {
    const userId = req.userId;
    console.log(`[download:list] Entry — userId=${userId}`);
    if (!userId) {
        console.warn(`[download:list] Unauthorized`);
        res.status(401).json({ message: "Unauthorized" });
        return;
    } 

    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const cursor = req.query.cursor as string | undefined
    console.log(`[download:list] Params: limit=${limit}, cursor=${cursor ?? "none"}`);

    try {
        console.log(`[download:list] Querying documents for userId=${userId}`);
        const documents = await prismaClient.document.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            take: limit + 1,
            ...(cursor && {
                cursor: { id: cursor },
                skip: 1,
            }),
            select: {
                id: true,
                title: true,
                status: true,
                ObjectKey: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        const hasMore = documents.length > limit;
        const page = hasMore ? documents.slice(0, -1) : documents;
        const nextCursor = hasMore ? page[page.length - 1]?.id : null;

        console.log(`[download:list] Returning ${page.length} documents, hasMore=${hasMore}, nextCursor=${nextCursor ?? "none"}`);
        res.status(200).json({ documents: page, nextCursor });
    } catch (e) {
        console.error(`[download:list] Failed to list documents:`, e);
        res.status(500).json({ message: "Failed to list documents" });
    }
});

/**
 * Delete a document: remove from Redis stream (even if queued/processing),
 * MinIO object, Qdrant points, and DB row.
 */
downloadRouter.delete("/:id", async (req, res) => {
    const userId = req.userId;
    const id = req.params.id;
    console.log(`[download:delete] Entry — userId=${userId}, documentId=${id}`);

    if (!userId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }

    try {
        const doc = await prismaClient.document.findFirst({
            where: { id, userId },
        });

        if (!doc) {
            console.warn(`[download:delete] Document not found: ${id}`);
            res.status(404).json({ message: "Document not found" });
            return;
        }

        // 1. Remove from all Redis streams so workers stop / never start
        try {
            const streams = [
                process.env.FILES_STREAM ?? "files_stream",
                process.env.PDF_STREAM ?? "pdf_stream",
                process.env.IMAGE_STREAM ?? "image_stream",
                process.env.AUDIO_STREAM ?? "audio_stream",
                process.env.VIDEO_STREAM ?? "video_stream",
                process.env.SCENE_STREAM ?? "scene_stream",
                process.env.EMBED_STREAM ?? "embed_stream",
                process.env.DLQ_STREAM ?? "dlq_stream",
            ];
            const groups = [
                process.env.FILES_GROUP ?? "files-workers",
                process.env.PDF_GROUP ?? "pdf-workers",
                process.env.IMAGE_GROUP ?? "image-workers",
                process.env.AUDIO_GROUP ?? "audio-workers",
                process.env.VIDEO_GROUP ?? "video-workers",
                process.env.SCENE_GROUP ?? "scene-workers",
                process.env.EMBED_GROUP ?? "embedding-workers",
                process.env.DLQ_GROUP ?? "dlq-workers",
            ];
            await removeDocumentFromAllStreams(doc.id, streams, groups);
            console.log(`[download:delete] Stream cleanup done for ${doc.id}`);
        } catch (e) {
            console.error(`[download:delete] Stream cleanup failed:`, e);
        }

        // 2. Delete MinIO object
        try {
            await s3.send(
                new DeleteObjectCommand({
                    Bucket: AWS_BUCKET_NAME,
                    Key: doc.ObjectKey,
                })
            );
            console.log(`[download:delete] MinIO object deleted: ${doc.ObjectKey}`);
        } catch (e) {
            console.error(`[download:delete] MinIO delete failed:`, e);
        }

        // 3. Delete Qdrant points for this document UUID
        if (COLLECTION) {
            try {
                await qdrantClient.delete(COLLECTION, {
                    wait: true,
                    filter: { must: [{ key: "documentId", match: { value: doc.id } }] },
                });
                console.log(`[download:delete] Qdrant points deleted for documentId=${doc.id}`);
            } catch (e) {
                console.error(`[download:delete] Qdrant delete failed:`, e);
            }
        }

        // 4. Delete DB row (source of truth for "gone")
        await prismaClient.document.delete({ where: { id: doc.id } });
        console.log(`[download:delete] Document deleted from DB: ${doc.id}`);

        res.status(200).json({ message: "Document deleted" });
    } catch (e) {
        console.error(`[download:delete] Error:`, e);
        res.status(500).json({
            message: "Failed to delete document",
            error: e instanceof Error ? e.message : e,
        });
    }
});


export default downloadRouter;
