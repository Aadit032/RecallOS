import { s3 } from "@repo/minio/client";
import  { GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { llamaClient, type Tier } from "./index";
import dotenv from "dotenv"
import type { ParsingCreateResponse, ParsingGetResponse } from "@llamaindex/llama-cloud/resources";
import fs from "fs";
import { Readable } from "stream";
import type { FileCreateResponse } from "@llamaindex/llama-cloud/resources.js";
dotenv.config();

const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME as string;

async function downloadToDisk(bucket: string, key: string, localPath: string) {
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await s3.send(command);
    
    if (!response.Body) throw new Error("No body returned");
    
    // Create read and write streams
    const readStream = response.Body as Readable;
    localPath = localPath + response.ContentType;
    const writeStream = fs.createWriteStream(localPath);
    
    // Pipe and handle completion
    return new Promise<void>((resolve, reject) => {
        readStream.pipe(writeStream);
        writeStream.on("finish", () => resolve());
        writeStream.on("error", reject);
        readStream.on("error", reject);
    });
}

async function uploadFile(path: string): Promise<FileCreateResponse>{
    const uploaded = await llamaClient.files.create({
      file: fs.createReadStream(path),
      purpose: 'parse',
    });
    return uploaded;
}

type env = "prod" | "staging" | "dev"

export async function createParseJob(key: string, tier: Tier, env: env): Promise<ParsingCreateResponse | null>{
    let createJob: ParsingCreateResponse;
    if(env === "prod"){
        const command = new GetObjectCommand({
            Bucket: AWS_BUCKET_NAME,
            Key: key,
        });
        const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 5 * 60 });
        createJob = await llamaClient.parsing.create({ 
            tier, 
            version: 'latest', 
            source_url: presignedUrl 
        });
        console.log("created a parsing job!!!")
    }else{
        const ext = key.split(".").pop();
        const localPath = `downloaded-${crypto.randomUUID()}.${ext}`;
        
        await downloadToDisk(AWS_BUCKET_NAME, key, localPath);
        console.log("Downloaded the pdf from minio onto disk at: " + localPath);
        
        const uploaded = await uploadFile(localPath);
        console.log("Uploaded the pdf to Llama project: " + uploaded.project_id);

        createJob = await llamaClient.parsing.create({ 
            tier, 
            version: 'latest', 
            file_id: uploaded.id
        });
        console.log("created a parsing job!!!")
    }   

    return createJob
}

export async function getFinishedJob(createJob: ParsingCreateResponse){
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