import Router from "express"
import { s3 } from "@repo/minio/client"
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { prismaClient } from "@repo/prisma/client"

const uploadRouter = Router();

const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME

uploadRouter.post("/file", async (req, res) => {
    const { fileName, contentType } = req.body();

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
    const { fileName, key, userId } = req.body();

    try{
        await prismaClient.document.create({
            data: {
                title: fileName,
                ObjectKey: key,
                userId
            }
        });

        res.status(200).json({ message: "Server confirmed the upload!!" });
    }catch(e){
        res.status(500).json({
            message: "Server failed to confirm the upload"
        })
    }

});


uploadRouter.get("/file", async (req, res) => {
    const { fileName } = req.body();

    const key = `pdf/${fileName}-${crypto.randomUUID()}`

    const command = new GetObjectCommand({
        Bucket: AWS_BUCKET_NAME,
        Key: key
    });
    
    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 5 * 60 });

    res.status(200).json({ presignedUrl });
});


export default uploadRouter;