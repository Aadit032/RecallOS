import { xAck, xReadGroup } from "@repo/redis-stream/client"
import LlamaCloud from '@llamaindex/llama-cloud'; 
import { s3 } from "@repo/minio/client";
import  { GetObjectCommand } from "@aws-sdk/client-s3"
import { prismaClient } from "@repo/prisma/client";
import dotenv from "dotenv"
dotenv.config();

const CONSUMER_GROUP = process.env.CONSUMER_GROUP as string;
const WORKER_ID = process.env.WORKER_ID as string;
const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME as string;

export const llamaClient = new LlamaCloud({
  apiKey: process.env['LLAMA_CLOUD_API_KEY'],
});

interface streamMessage {
    id: string,
    message: { documentId: string }
}

async function workers(){
    
    while(true){
        const response: streamMessage | undefined = await xReadGroup(CONSUMER_GROUP, WORKER_ID);
        if(!response){
            console.log("No response from the stream...")
            continue;
        }

        try{
            await processDocuments(response);
            await xAck(CONSUMER_GROUP, response.id);
        }catch(e){
            console.log("Error: ", e instanceof Error ? e.message : e);
        }

    }
}

async function processDocuments(streamMessage: streamMessage){
    // parse => chunk => enrich context => get embeddings => store in vector db + bm25 index => xAck

    try{
        const document = await prismaClient.document.update({
            where: { id: streamMessage.message.documentId },
            data: { status: "PROCESSING" },
            select: { ObjectKey: true }
        });
        if(!document){
            console.log("No document found for that docuemntId");
            return;
        }
    
        const response = await s3.send(new GetObjectCommand({
            Bucket: AWS_BUCKET_NAME,
            Key: document.ObjectKey
        }));
        if(!response){
            console.log("No response from the s3 bucket.");
        }

        

    }catch(e){
        console.log("failed processing documents. Error: ", e instanceof Error? e.message : e);
    }
}