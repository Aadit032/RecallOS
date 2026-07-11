import Router from "express"
import { s3 } from "@repo/minio/client"
import { PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { prismaClient } from "@repo/prisma/client"
import { xAdd } from "@repo/redis-stream/client"

const uploadRouter = Router();

const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME

uploadRouter.post("/post-file-url", async (req, res) => {
    const userId = req.userId;
    console.log(`[upload:post-file-url] Entry — userId=${userId}`);
    if (!userId) {
        console.warn(`[upload:post-file-url] Unauthorized`);
        res.status(401).json({ message: "Unauthorized" });
        return;
    }

    const { fileName, contentType } = req.body;
    console.log(`[upload:post-file-url] Request: fileName="${fileName}", contentType="${contentType}"`);
     if (!fileName || !contentType) {
        console.warn(`[upload:post-file-url] Missing required fields`);
        res.status(400).json({ message: "Missing required fields: fileName, contentType" });
        return;
    }

    const ALLOWED_TYPES = ["application/pdf"];
    if (!ALLOWED_TYPES.includes(contentType)) {
        console.warn(`[upload:post-file-url] Unsupported content type: "${contentType}"`);
        res.status(400).json({ message: "Unsupported content type" });
        return;
    }

    const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `pdf/${safeFileName}-${crypto.randomUUID()}`;
    console.log(`[upload:post-file-url] Generated S3 key: "${key}"`);

    const command = new PutObjectCommand({
        Bucket: AWS_BUCKET_NAME,
        Key: key,
        ContentType: contentType,
    });
    
    console.log(`[upload:post-file-url] Generating presigned PUT URL for bucket="${AWS_BUCKET_NAME}"`);
    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 5 * 60 });
    console.log(`[upload:post-file-url] Presigned URL generated (expires in 5 min)`);

    res.status(200).json({ presignedUrl, key });
});


uploadRouter.post("/confirm", async (req, res) => {
    const { fileName, key, size } = req.body;
    const userId = req.userId
    console.log(`[upload:confirm] Entry — userId=${userId}, fileName="${fileName}", key="${key}", size=${size}`);

    if (!key || !fileName || !userId || !size) {
        console.warn(`[upload:confirm] Missing required fields`);
        res.status(400).json({ message: "Missing required fields: fileName, key, size" });
        return;
    }

    try{
        console.log(`[upload:confirm] Verifying file in MinIO — bucket="${AWS_BUCKET_NAME}", key="${key}"`);
        const command = new HeadObjectCommand({ Bucket: AWS_BUCKET_NAME, Key: key });
        const response = await s3.send(command);
        console.log(`[upload:confirm] MinIO file size: ${response.ContentLength}, expected: ${size}`);
        
        if (response.ContentLength! !== Number(size)){
            console.warn(`[upload:confirm] Size mismatch — file not uploaded correctly`);
            res.status(403).json({ 
                message: "The file has not been uploaded correctly. Please try again. File not inserted in DB." 
            });
            return;
        }

        let document;
        let isNew = true; 
        
        try{
            console.log(`[upload:confirm] Creating document record in DB`);
            document = await prismaClient.document.create({
                data: {
                    title: fileName,
                    ObjectKey: key,
                    userId,
                    status: "QUEUED"
                }
            });
            console.log(`[upload:confirm] Document created: id=${document.id}`);
        }catch(e: any){
            if(e.code === "P2002"){
                console.log(`[upload:confirm] Duplicate key — fetching existing document`);
                isNew = false;
                document = await prismaClient.document.findUniqueOrThrow({
                    where: { ObjectKey: key }
                });
                console.log(`[upload:confirm] Existing document found: id=${document.id}`);
            }else throw e;

        }
        if (isNew) {
            console.log(`[upload:confirm] Pushing document ${document.id} onto Redis stream`);
            const messageId = await xAdd(document.id);
            if (!messageId) {
                console.error(`[upload:confirm] Failed to push onto queue`);
                res.status(500).json({ message: "The file was not pushed on the queue." });
                return;
            }
            console.log(`[upload:confirm] Pushed to stream: messageId=${messageId}`);
            try {
                document = await prismaClient.document.update({
                    where: { id: document.id },
                    data: { streamMessageId: messageId }
                });
                console.log(`[upload:confirm] Stored streamMessageId on document ${document.id}`);
            } catch (e) {
                console.error(`[upload:confirm] Failed to store streamMessageId:`, e);
            }
        }

        console.log(`[upload:confirm] Confirm successful — documentId=${document.id}`);
        res.status(200).json({ message: "Server confirmed the upload!!", documentId: document.id });
    }catch(e){
        console.error(`[upload:confirm] Server failed to confirm:`, e);

        try {
            console.log(`[upload:confirm] Setting document status to FAILED for key="${key}"`);
            await prismaClient.document.update({
                where: { ObjectKey: key },
                data: { status: "FAILED" }
            });
        } catch (innerErr) {
            console.error(`[upload:confirm] Also failed to record FAILED status:`, innerErr);
        }
        
        res.status(500).json({ message: "Server failed to confirm the upload" + e });
    }

});


export default uploadRouter;