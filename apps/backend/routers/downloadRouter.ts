import { Router } from "express"
import { prismaClient } from "@repo/prisma/client";
import { GetObjectCommand } from "@aws-sdk/client-s3"
import { s3 } from "@repo/minio/client";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import dotenv from "dotenv"
dotenv.config();

const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME

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


export default downloadRouter;