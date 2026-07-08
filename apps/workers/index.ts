import { xAck, xReadGroup } from "@repo/redis-stream/client"
import LlamaCloud from '@llamaindex/llama-cloud'; 
import runParseJob from "./parse";
import { prismaClient } from "@repo/prisma/client";
import chunkMarkdown from "./chunk"
import { openrouterClient } from "@repo/openrouter/client"
import dotenv from "dotenv"
dotenv.config();

const CONSUMER_GROUP = process.env.CONSUMER_GROUP as string;
const WORKER_ID = process.env.WORKER_ID as string;

export const llamaClient = new LlamaCloud({
  apiKey: process.env['LLAMA_CLOUD_API_KEY'],
});

const MAX_RETRIES = 3;

interface streamMessage {
    id: string,
    message: { documentId: string }
}

export type Tier =
    | "fast"
    | "cost_effective"
    | "agentic"
    | "agentic_plus";

type PricingTier = "basic" | "pro" | "max"

const PROMPT =`<document> 
    {{WHOLE_DOCUMENT}} 
    </document> 
    Here is the chunk we want to situate within the whole document 
    <chunk> 
    {{CHUNK_CONTENT}} 
    </chunk> 
    Please give a short succinct context to situate this 
    chunk within the overall document for the purposes of improving search retrieval of the chunk. 
    Answer only with the succinct context and nothing else.`

async function workers(){    
    while(true){
        const response: streamMessage | undefined = await xReadGroup(CONSUMER_GROUP, WORKER_ID);
        if(!response){
            console.log("No response from the stream...")
            continue;
        }

        try{
            await processDocuments(response, "basic");
            await xAck(CONSUMER_GROUP, response.id);
        }catch(e){
            console.log("Error: ", e instanceof Error ? e.message : e);
        }
    }
}

async function processDocuments(streamMessage: streamMessage, pricingTier: PricingTier){
    // parse => chunk => enrich context => get embeddings => store in vector db + bm25 index
    try{
        const document = await prismaClient.document.update({
            where: { id: streamMessage.message.documentId },
            data: { status: "PROCESSING" },
            select: { ObjectKey: true }
        });
        
        // Parse the document into markdown
        let markdown: string | null = null;
        let tier: Tier;

        if(pricingTier == "basic") {
            tier = "fast";
        }else if(pricingTier == "max"){
            tier = "cost_effective";
        }else{
            tier = "agentic_plus";
        }

        for(let i = 0; i < MAX_RETRIES; i++){
            markdown = await runParseJob(document.ObjectKey, tier);
            if (markdown) {
                break;
            }
            console.log(`Attempt ${i + 1} failed. Retrying...`);
        }
        if(!markdown){
            await prismaClient.document.update({
                where: { id: streamMessage.message.documentId },
                data: { status: "FAILED" },
            });
            console.log("Max attempts reached.");
            return;
        }

        // Chunk the parsed document
        const chunks = chunkMarkdown(markdown);

        console.log("Number of chunks: ", chunks.length);
        console.log("Example chunk text: ", chunks[0]!.text);

        // Add context to every chunk
        if(pricingTier !== "basic"){

        }

    }catch(e){
        console.log("Failed processing documents. Error: ", e instanceof Error? e.message : e);
    }
}