import Router from "express"
import { s3 } from "@repo/minio/client"
import { PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { prismaClient } from "@repo/prisma/client"
import { xAdd } from "@repo/redis-stream/client"

const uploadRouter = Router();

const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME

uploadRouter.post("/post-file-url", async (req, res) => {
    const { fileName, contentType } = req.body;

    const key = `pdf/${fileName}-${crypto.randomUUID()}`

    const command = new PutObjectCommand({
        Bucket: AWS_BUCKET_NAME,
        Key: key,
        ContentType: contentType,
    });
    
    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 5 * 60 });

    res.status(200).json({ presignedUrl, key });
});


uploadRouter.post("/confirm", async (req, res) => {
    const { fileName, key } = req.body;
    const size = Number(req.body.size);

    try{
        const command = new HeadObjectCommand({ Bucket: AWS_BUCKET_NAME, Key: key });
        const response = await s3.send(command);
        
        if (response.ContentLength! !== size){
            res.status(403).json({ 
                message: "The file has not been uploaded correctly. Please try again. File not inserted in DB." 
            });
            return;
        }
        
        const document = await prismaClient.document.create({
            data: {
                title: fileName,
                ObjectKey: key,
                userId: req.userId!,
                status: "QUEUED"
            }
        });
        
        const messageId = await xAdd(document.id);
        if(!messageId) return res.status(500).json({ message: "The file was not pushed on the queue." });

        res.status(200).json({ message: "Server confirmed the upload!!" });
    }catch(e){
        res.status(500).json({
            message: "Server failed to confirm the upload"
        })
    }

});


uploadRouter.post("/get-file-url", async (req, res) => {
    const { fileName } = req.body;

    const key = `pdf/${fileName}-${crypto.randomUUID()}`

    const command = new GetObjectCommand({
        Bucket: AWS_BUCKET_NAME,
        Key: key
    });
    
    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 5 * 60 });

    res.status(200).json({ presignedUrl });
});


export default uploadRouter;