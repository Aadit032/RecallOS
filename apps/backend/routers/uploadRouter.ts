import express from "express"
import { s3 } from "@repo/minio/client"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

const uploadRouter = express();

const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME

uploadRouter.post("/pdf", async (req, res) => {
    const { fileName, contentType } = await req.body();

    const key = `pdf/${fileName}-${crypto.randomUUID()}`

    const command = new PutObjectCommand({
        Bucket: AWS_BUCKET_NAME,
        Key: key,
        ContentType: contentType,
    });
    
    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 5 * 60 });

    res.status(200).json({ presignedUrl });
});

export default uploadRouter;