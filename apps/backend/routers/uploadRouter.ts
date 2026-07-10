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
    if (!userId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }

    const { fileName, contentType } = req.body;
     if (!fileName || !contentType) {
        res.status(400).json({ message: "Missing required fields: fileName, contentType" });
        return;
    }

    const ALLOWED_TYPES = ["application/pdf"];
    if (!ALLOWED_TYPES.includes(contentType)) {
        res.status(400).json({ message: "Unsupported content type" });
        return;
    }

    const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `pdf/${safeFileName}-${crypto.randomUUID()}`;

    const command = new PutObjectCommand({
        Bucket: AWS_BUCKET_NAME,
        Key: key,
        ContentType: contentType,
    });
    
    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 5 * 60 });

    res.status(200).json({ presignedUrl, key });
});


uploadRouter.post("/confirm", async (req, res) => {
    const { fileName, key, size } = req.body;
    const userId = req.userId

    console.log("userId: " + userId)
    if (!key || !fileName || !userId || !size) {
        res.status(400).json({ message: "Missing required fields: fileName, key, size" });
        return;
    }

    try{
        const command = new HeadObjectCommand({ Bucket: AWS_BUCKET_NAME, Key: key });
        const response = await s3.send(command);
        console.log(`file size recieved from minio: ${response.ContentLength}`)
        
        if (response.ContentLength! !== Number(size)){
            console.log("The file has not been uploaded correctly. Please try again. File not inserted in DB.");
            res.status(403).json({ 
                message: "The file has not been uploaded correctly. Please try again. File not inserted in DB." 
            });
            return;
        }

        let document;
        let isNew = true; 
        
        try{
            document = await prismaClient.document.create({
                data: {
                    title: fileName,
                    ObjectKey: key,
                    userId,
                    status: "QUEUED"
                }
            });
        }catch(e: any){
            if(e.code === "P2002"){
                isNew = false;
                document = await prismaClient.document.findUniqueOrThrow({
                    where: { ObjectKey: key }
                });
            }else throw e;

        }
        if (isNew) {
            const messageId = await xAdd(document.id);
            if (!messageId) {
                res.status(500).json({ message: "The file was not pushed on the queue." });
                return;
            }
        }

        res.status(200).json({ message: "Server confirmed the upload!!", documentId: document.id });
    }catch(e){
        console.log("Server failed to confirm the upload" + e);

        try {
            await prismaClient.document.update({
                where: { ObjectKey: key },
                data: { status: "FAILED" }
            });
        } catch (innerErr) {
            console.log("Also failed to record FAILED status:", innerErr);
        }
        
        res.status(500).json({ message: "Server failed to confirm the upload" + e });
    }

});


export default uploadRouter;