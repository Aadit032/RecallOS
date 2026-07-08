import { xReadGroup } from "@repo/redis-stream/client"
import LlamaCloud from '@llamaindex/llama-cloud'; 
import dotenv from "dotenv"
dotenv.config();

const CONSUMER_GROUP = process.env.CONSUMER_GROUP as string;
const WORKER_ID = process.env.WORKER_ID as string;


export const client = new LlamaCloud({
  apiKey: process.env['LLAMA_CLOUD_API_KEY'],
});

async function workers(){
    
    while(true){
        const documentId = await xReadGroup(CONSUMER_GROUP, WORKER_ID);

        // parse => chunk => enrich context => get embeddings => store in vector db + bm25 index => xAck
    }
}