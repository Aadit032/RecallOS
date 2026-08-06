import Router from "express"
import { s3 } from "@repo/minio/client"
import { PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { prismaClient } from "@repo/prisma/client"
import { xAddToStream } from "@repo/redis-stream/client"
import { modalityFromMime, normalizeTags } from "../services/uploadService.ts"
import {
    assertOwnedUploadKey,
    buildUploadObjectKey,
    isAllowedMimeType,
    MAX_UPLOAD_BYTES,
    normalizeMimeType,
} from "../security/uploadPolicy.ts"
import { sendSafeError } from "../security/httpErrors.ts"

const uploadRouter = Router();

const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME
const FILES_STREAM = process.env.FILES_STREAM ?? "files_stream";

uploadRouter.post("/post-file-url", async (req, res) => {
    const userId = req.userId;
    console.log(`[upload:post-file-url] Entry — userId=${userId}`);
    if (!userId) {
        console.warn(`[upload:post-file-url] Unauthorized`);
        res.status(401).json({ message: "Unauthorized" });
        return;
    }

    const { fileName, contentType, size } = req.body;
    console.log(`[upload:post-file-url] Request: fileName="${fileName}", contentType="${contentType}", size=${size}`);
    if (!fileName || !contentType) {
        console.warn(`[upload:post-file-url] Missing required fields`);
        res.status(400).json({ message: "Missing required fields: fileName, contentType" });
        return;
    }

    if (typeof fileName !== "string" || fileName.length > 255) {
        res.status(400).json({ message: "Invalid fileName" });
        return;
    }

    if (typeof contentType !== "string" || !isAllowedMimeType(contentType)) {
        res.status(400).json({
            message: "Unsupported content type. Allowed: PDF, text, common images, audio, and video.",
        });
        return;
    }

    const mimeType = normalizeMimeType(contentType);
    if (size != null) {
        const n = Number(size);
        if (!Number.isFinite(n) || n <= 0 || n > MAX_UPLOAD_BYTES) {
            res.status(400).json({
                message: `File size must be between 1 and ${MAX_UPLOAD_BYTES} bytes`,
            });
            return;
        }
    }

    const key = buildUploadObjectKey(userId, mimeType, fileName);
    console.log(`[upload:post-file-url] Generated S3 key: "${key}"`);

    const command = new PutObjectCommand({
        Bucket: AWS_BUCKET_NAME,
        Key: key,
        ContentType: mimeType,
        // When client knows size, bind Content-Length into the signed request
        ...(size != null && Number.isFinite(Number(size))
            ? { ContentLength: Number(size) }
            : {}),
    });
    
    console.log(`[upload:post-file-url] Generating presigned PUT URL for bucket="${AWS_BUCKET_NAME}"`);
    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 5 * 60 });
    console.log(`[upload:post-file-url] Presigned URL generated (expires in 5 min)`);

    res.status(200).json({
        presignedUrl,
        key,
        maxBytes: MAX_UPLOAD_BYTES,
        contentType: mimeType,
    });
});

uploadRouter.post("/confirm", async (req, res) => {
    const { fileName, key, size, contentType, tags: rawTags } = req.body;
    const userId = req.userId
    console.log(`[upload:confirm] Entry — userId=${userId}, fileName="${fileName}", key="${key}", size=${size}`);

    if (!key || !fileName || !userId || size == null) {
        console.warn(`[upload:confirm] Missing required fields`);
        res.status(400).json({ message: "Missing required fields: fileName, key, size" });
        return;
    }

    if (typeof fileName !== "string" || fileName.length > 255) {
        res.status(400).json({ message: "Invalid fileName" });
        return;
    }
    if (typeof key !== "string") {
        res.status(400).json({ message: "Invalid key" });
        return;
    }

    try {
        assertOwnedUploadKey(userId, key);
    } catch (e) {
        console.warn(`[upload:confirm] Key ownership failed:`, e);
        res.status(403).json({ message: "Forbidden: invalid object key for this user" });
        return;
    }

    const sizeNum = Number(size);
    if (!Number.isFinite(sizeNum) || sizeNum <= 0 || sizeNum > MAX_UPLOAD_BYTES) {
        res.status(400).json({
            message: `File size must be between 1 and ${MAX_UPLOAD_BYTES} bytes`,
        });
        return;
    }

    let mimeType: string;
    if (contentType && typeof contentType === "string" && isAllowedMimeType(contentType)) {
        mimeType = normalizeMimeType(contentType);
    } else if (key.includes("/image/")) {
        mimeType = "image/png";
    } else if (key.includes("/audio/")) {
        mimeType = "audio/mpeg";
    } else if (key.includes("/video/")) {
        mimeType = "video/mp4";
    } else {
        mimeType = "application/pdf";
    }

    // Ensure modality folder matches claimed MIME
    const folder = key.split("/")[2]; // uploads/{userId}/{folder}/...
    const expectedFolder =
        mimeType.startsWith("image/") ? "image" :
        mimeType.startsWith("audio/") ? "audio" :
        mimeType.startsWith("video/") ? "video" : "pdf";
    if (folder !== expectedFolder) {
        res.status(400).json({ message: "Content type does not match object key path" });
        return;
    }

    const tags = normalizeTags(rawTags);
    console.log(`[upload:confirm] mimeType="${mimeType}", tags=${JSON.stringify(tags)}`);

    try{
        console.log(`[upload:confirm] Verifying file in MinIO — bucket="${AWS_BUCKET_NAME}", key="${key}"`);
        const command = new HeadObjectCommand({ Bucket: AWS_BUCKET_NAME, Key: key });
        const response = await s3.send(command);
        const actualSize = response.ContentLength ?? 0;
        console.log(`[upload:confirm] MinIO file size: ${actualSize}, expected: ${sizeNum}`);
        
        if (actualSize !== sizeNum){
            console.warn(`[upload:confirm] Size mismatch — file not uploaded correctly`);
            res.status(403).json({ 
                message: "The file has not been uploaded correctly. Please try again. File not inserted in DB." 
            });
            return;
        }

        if (actualSize > MAX_UPLOAD_BYTES) {
            res.status(413).json({ message: "Uploaded object exceeds maximum allowed size" });
            return;
        }

        // Optional Content-Type check against stored object metadata
        if (response.ContentType) {
            const stored = normalizeMimeType(response.ContentType);
            if (stored !== mimeType && stored !== "application/octet-stream") {
                console.warn(`[upload:confirm] Content-Type mismatch object=${stored} claimed=${mimeType}`);
                // Soft mismatch: prefer object metadata when allowed
                if (isAllowedMimeType(stored)) {
                    mimeType = stored;
                }
            }
        }

        let document;
        let isNew = true; 
        
        try{
            console.log(`[upload:confirm] Creating document record in DB`);
            document = await prismaClient.document.create({
                data: {
                    title: fileName.slice(0, 240),
                    ObjectKey: key,
                    userId,
                    mimeType,
                    modality: modalityFromMime(mimeType),
                    status: "UPLOADED",
                    tags,
                }
            });
            console.log(`[upload:confirm] Document created: id=${document.id}`);
        }catch(e: any){
            if(e.code === "P2002"){
                // Unique ObjectKey: only surface if THIS user already owns it
                console.log(`[upload:confirm] Duplicate key — checking ownership`);
                const existing = await prismaClient.document.findUnique({
                    where: { ObjectKey: key },
                });
                if (!existing || existing.userId !== userId) {
                    console.warn(`[upload:confirm] Duplicate key not owned by requester — denying`);
                    res.status(409).json({ message: "Object key conflict" });
                    return;
                }
                isNew = false;
                document = existing;
                console.log(`[upload:confirm] Existing document found: id=${document.id}`);
            }else throw e;

        }
        if (isNew) {
            console.log(`[upload:confirm] Pushing document ${document.id} onto files_stream`);
            const messageId = await xAddToStream(FILES_STREAM, { docId: document.id });
            if (!messageId) {
                console.error(`[upload:confirm] Failed to push onto files_stream`);
                res.status(500).json({ message: "The file was not pushed on the queue." });
                return;
            }
            console.log(`[upload:confirm] Pushed to files_stream: messageId=${messageId}`);
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
            // Only mark FAILED for documents owned by this user
            const owned = await prismaClient.document.findFirst({
                where: { ObjectKey: key, userId },
                select: { id: true },
            });
            if (owned) {
                await prismaClient.document.update({
                    where: { id: owned.id },
                    data: { status: "FAILED" }
                });
            }
        } catch (innerErr) {
            console.error(`[upload:confirm] Also failed to record FAILED status:`, innerErr);
        }
        
        sendSafeError(res, 500, "Server failed to confirm the upload", e, "upload:confirm");
    }

});


export default uploadRouter;
