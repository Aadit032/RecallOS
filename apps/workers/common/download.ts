import { s3 } from "@repo/minio/client";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import fs from "fs";

const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME as string;

export async function downloadToDisk(key: string, localPath: string): Promise<void> {
    const command = new GetObjectCommand({ Bucket: AWS_BUCKET_NAME, Key: key });
    const response = await s3.send(command);
    if (!response.Body) throw new Error("No body returned");

    const readStream = response.Body as Readable;
    const writeStream = fs.createWriteStream(localPath);

    return new Promise<void>((resolve, reject) => {
        readStream.pipe(writeStream);
        writeStream.on("finish", () => resolve());
        writeStream.on("error", reject);
        readStream.on("error", reject);
    });
}

export async function getObjectStream(key: string): Promise<Readable> {
    const command = new GetObjectCommand({ Bucket: AWS_BUCKET_NAME, Key: key });
    const response = await s3.send(command);
    if (!response.Body) throw new Error("No body returned");
    return response.Body as Readable;
}
