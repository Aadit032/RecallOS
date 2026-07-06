import { S3Client } from "@aws-sdk/client-s3";
import dotenv from "dotenv"
dotenv.config();

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT
const MINIO_ACCESSKEYID = process.env.MINIO_ACCESSKEYID as string
const MINIO_SECRET_ACCESS_KEY = process.env.MINIO_SECRET_ACCESS_KEY as string

export const s3 = new S3Client({
  region: "us-east-1",
  endpoint: MINIO_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: MINIO_ACCESSKEYID,
    secretAccessKey: MINIO_SECRET_ACCESS_KEY,
  },
});