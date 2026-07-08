import { s3 } from "@repo/minio/client";
import  { GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { llamaClient, type Tier } from "./index";
import dotenv from "dotenv"
dotenv.config();

const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME as string;

interface ParsingCreateResponse {
  id: string;
  project_id: string;
  status: 'CANCELLED' | 'COMPLETED' | 'FAILED' | 'PENDING' | 'RUNNING';
  created_at?: string | null;
  error_message?: string | null;
  name?: string | null;
  tier?: string | null;
  updated_at?: string | null;
  user_metadata?: { [key: string]: string } | null;
}

export default async function parseDocument(key: string, tier: Tier): Promise<ParsingCreateResponse>{
    const command = new GetObjectCommand({
        Bucket: AWS_BUCKET_NAME,
        Key: key,
    });
    
    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 5 * 60 });

    const parsed = await llamaClient.parsing.create({ tier, version: 'latest', source_url: presignedUrl });

    return parsed
}