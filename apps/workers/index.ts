import { xAck, xReadGroup } from "@repo/redis-stream/client"
import LlamaCloud from '@llamaindex/llama-cloud'; 
import parseDocument from "./parse";
import { prismaClient } from "@repo/prisma/client";
import dotenv from "dotenv"
dotenv.config();

const CONSUMER_GROUP = process.env.CONSUMER_GROUP as string;
const WORKER_ID = process.env.WORKER_ID as string;

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

export type Tier =
    | "fast"
    | "cost_effective"
    | "agentic"
    | "agentic_plus";

async function processDocuments(streamMessage: streamMessage){
    // parse => chunk => enrich context => get embeddings => store in vector db + bm25 index
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
        
        const parsed = await parseDocument(document.ObjectKey, "fast");
        

    }catch(e){
        console.log("Failed processing documents. Error: ", e instanceof Error? e.message : e);
    }
}