import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";
import dotenv from "dotenv";
dotenv.config();

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT;
const MINIO_ACCESSKEYID = process.env.MINIO_ACCESSKEYID as string;
const MINIO_SECRET_ACCESS_KEY = process.env.MINIO_SECRET_ACCESS_KEY as string;
const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME as string;

export const s3 = new S3Client({
  region: "us-east-1",
  endpoint: MINIO_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: MINIO_ACCESSKEYID,
    secretAccessKey: MINIO_SECRET_ACCESS_KEY,
  },
});

export async function ensureBucketExists(bucket: string = AWS_BUCKET_NAME) {
    try {
        await s3.send(new HeadBucketCommand({ Bucket: bucket }));
        console.log(`Bucket "${bucket}" already exists.`);
    } catch (e: any) {
        // MinIO/S3 return 404 (NotFound) or sometimes 403 depending on setup
        if (e.name === "NotFound" || e.$metadata?.httpStatusCode === 404) {
            console.log(`Bucket "${bucket}" not found. Creating...`);
            await s3.send(new CreateBucketCommand({ Bucket: bucket }));
            console.log(`Bucket "${bucket}" created.`);
        } else {
            throw e;
        }
  }
}

ensureBucketExists();