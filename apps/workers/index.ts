import { xAck, xReadGroup } from "@repo/redis-stream/client"
import LlamaCloud from '@llamaindex/llama-cloud'; 
import runParseJob from "./parse";
import { prismaClient } from "@repo/prisma/client";
import chunkMarkdown, { type Chunk } from "./chunk"
import { openrouterClient } from "@repo/openrouter/client"
import { InferenceClient } from "@huggingface/inference";
import dotenv from "dotenv"
dotenv.config();

const CONSUMER_GROUP = process.env.CONSUMER_GROUP as string;
const WORKER_ID = process.env.WORKER_ID as string;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL as string;

const inferenceClient = new InferenceClient(process.env.HF_TOKEN)

export const llamaClient = new LlamaCloud({
  apiKey: process.env['LLAMA_CLOUD_API_KEY'],
});

const MAX_RETRIES = 3;

interface streamMessage {
    id: string,
    message: { documentId: string }
}

export type Tier = "fast" | "cost_effective" | "agentic" | "agentic_plus";

type PricingTier = "basic" | "pro" | "max"

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
        let chunks: Chunk[] = chunkMarkdown(markdown);

        console.log("Number of chunks: ", chunks.length);
        console.log("Example chunk text: ", chunks[0]!.text);

        // Add context to every chunk
        if(pricingTier !== "basic"){

            // ONLY DO THIS IF DOC IS SMALL, IF ITS LARGE, GET CONTEXT FROM NEARBY CHUNKS, DONT PASS THE WHOLE DOC

            // chunks = await Promise.all(chunks.map(async (chunk) => {
            //     const PROMPT =`<document> 
            //     ${markdown}
            //     </document> 
            //     Here is the chunk we want to situate within the whole document 
            //     <chunk> 
            //     ${chunk.text}
            //     </chunk> 
            //     Please give a short succinct context to situate this 
            //     chunk within the overall document for the purposes of improving search retrieval of the chunk. 
            //     Answer only with the succinct context and nothing else.`
            //     const response = await openrouterClient.chat.send({
            //         chatRequest: {
            //             model: 'openrouter/free',
            //             messages: [{ role: 'user', content: PROMPT }],
            //         }
            //     })
            //     const context = response.choices[0]!.message.content;
            //     if(!context){
            //         console.log("No response from openrouter for context enrichment of chunks");
            //         return;
            //     }
            //     console.log(context);
            //     return {
            //         ...chunk,
            //         context
            //     }
            // }))

            for(let i = 0; i < chunks.length; i ++){
                let chunk = chunks[i]?.text;


                const response = await openrouterClient.chat.send({
                    chatRequest: {
                        model: 'openrouter/free',
                        messages: [{ role: 'user', content: PROMPT }],
                    }
                })
                if(!response){
                    console.log("No response from openrouter for contextual retreival on chunks");
                    return;
                }
                chunk = response.choices[0]!.message.content;
                if(!chunk){
                    console.log("No response from openrouter for context enrichment of chunks");
                    return;
                }
                console.log(chunk);
            }
        }


        // get embeddings
        const embeddings = await Promise.all(chunks.map(chunk => {
            inferenceClient.featureExtraction({
                model: EMBEDDING_MODEL,
                inputs: chunk.text,
            });
        }));


    }catch(e){
        console.log("Failed processing documents. Error: ", e instanceof Error? e.message : e);
    }
}