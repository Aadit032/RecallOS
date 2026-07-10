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

console.log(`[minio] Initializing S3 client — endpoint="${MINIO_ENDPOINT}", bucket="${AWS_BUCKET_NAME}"`);

export const s3 = new S3Client({
  region: "us-east-1",
  endpoint: MINIO_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: MINIO_ACCESSKEYID,
    secretAccessKey: MINIO_SECRET_ACCESS_KEY,
  },
});

console.log(`[minio] S3 client created`);

export async function ensureBucketExists(bucket: string = AWS_BUCKET_NAME) {
    console.log(`[minio:ensureBucketExists] Checking bucket: "${bucket}"`);
    try {
        await s3.send(new HeadBucketCommand({ Bucket: bucket }));
        console.log(`[minio:ensureBucketExists] Bucket "${bucket}" already exists.`);
    } catch (e: any) {
        if (e.name === "NotFound" || e.$metadata?.httpStatusCode === 404) {
            console.log(`[minio:ensureBucketExists] Bucket "${bucket}" not found. Creating...`);
            await s3.send(new CreateBucketCommand({ Bucket: bucket }));
            console.log(`[minio:ensureBucketExists] Bucket "${bucket}" created.`);
        } else {
            console.error(`[minio:ensureBucketExists] Error checking bucket:`, e);
            throw e;
        }
  }
}

ensureBucketExists();