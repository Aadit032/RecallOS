import { s3 } from "@repo/minio/client";
import  { GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { llamaClient, type Tier } from "./index";
import dotenv from "dotenv"
import type { ParsingCreateResponse, ParsingGetResponse } from "@llamaindex/llama-cloud/resources";
dotenv.config();

const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME as string;

export default async function runParseJob(key: string, tier: Tier): Promise<string | null>{
    const command = new GetObjectCommand({
        Bucket: AWS_BUCKET_NAME,
        Key: key,
    });
    
    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 5 * 60 });

    const createJob: ParsingCreateResponse = await llamaClient.parsing.create({ 
        tier, 
        version: 'latest', 
        source_url: presignedUrl 
    });

    let getJob: ParsingGetResponse = await llamaClient.parsing.get(createJob.id, {expand: ["markdown"]});
    while(getJob.job.status !== "COMPLETED" && getJob.job.status !== "FAILED"){
        await new Promise(resolve => setTimeout(resolve, 1000));

        getJob = await llamaClient.parsing.get(createJob.id, {
            expand: ["markdown"],
        });
    };

    if(getJob.job.status === "FAILED"){
        console.log("Parsing failed. Try again.");
        return null;
    }

    if(!getJob.markdown_full){
        console.log("Cant get the markdown from the completed job");
        return null;
    }

    return getJob.markdown_full
}
