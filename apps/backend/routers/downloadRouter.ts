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
    const { key } = req.body;
    if (!key) {
        res.status(400).json({ message: "Missing required field: ObjectKey" });
        return;
    }

    try{
        const command = new GetObjectCommand({
            Bucket: AWS_BUCKET_NAME,
            Key: key
        });

        const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 5 * 60 });
        res.status(200).json({ presignedUrl });
    }catch(e){
        console.log("Server error while getting presigned url for downloading." + e)
        res.status(500).json({ message: "Server error while getting presigned url for downloading." + e })
    }
});

downloadRouter.get("/list", async (req, res) => {
    const userId = req.userId;
    if (!userId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }

    try {
        const documents = await prismaClient.document.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                title: true,
                status: true,
                ObjectKey: true,
                createdAt: true,
                updatedAt: true,
            },
        });
        res.status(200).json({ documents });
    } catch (e) {
        console.log("Failed to list documents: ", e);
        res.status(500).json({ message: "Failed to list documents" });
    }
});


export default downloadRouter;