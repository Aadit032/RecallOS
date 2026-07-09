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
const CONTEXT_MODEL = process.env.CONTEXT_MODEL as string;

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

async function getContextChunks(chunks: Chunk[], full_doc: string): Promise<Chunk[]>{
    chunks = await Promise.all(chunks.map(async (chunk) => {
            const CONTEXT_PROMPT =`<document> 
                ${full_doc}
                </document> 
                Here is the chunk we want to situate within the whole document 
                <chunk> 
                ${chunk.text}
                </chunk> 
                Please give a short succinct context to situate this 
                chunk within the overall document for the purposes of improving search retrieval of the chunk. 
                Answer only with the succinct context and nothing else.`

            const response = await openrouterClient.chat.send({
                chatRequest: {
                    model: CONTEXT_MODEL,
                    messages: [{ role: 'user', content: CONTEXT_PROMPT }],
                }
            })
            if(!response){
                console.log("No response from openrouter for contextual retreival on chunks");
                return chunk;
            }
            chunk.text = response.choices[0]!.message.content;
            console.log(chunk);

            return chunk;
        }))

    return chunks;
}

async function contextualRetrieval(full_doc: string, chunks: Chunk[]): Promise<Chunk[]>{
    const isSmall = full_doc.length > 5000 ? true : false;

    if(isSmall){
        getContextChunks(chunks, full_doc);
    }else{
        const SUMMARY_PROMPT = `You are a precise document summarizer. Given the document below, produce a summary that:
            1. Captures the core argument/purpose in 1-2 sentences (TL;DR)
            2. Lists 3-7 key points as bullets, in order of importance
            3. Preserves any critical numbers, dates, names, or decisions verbatim
            4. Flags open questions, risks, or action items separately if present
            5. Omits filler, repetition, and examples unless they carry unique information

            Constraints:
            - Do not add information not in the source
            - Do not editorialize or add opinions
            - Match the summary length to content density, not document length (target: {N} words / {N}% of original)
            - If the document is ambiguous or contradictory, note it rather than resolving it silently

            Output format:
            **TL;DR:** ...
            **Key Points:**
            - ...
            **Action Items / Open Questions:** (omit if none)
            - ...

            Document:
            ${full_doc}`

        const res = await openrouterClient.chat.send({
            chatRequest: {
                model: CONTEXT_MODEL,
                messages: [{ role: 'user', content: SUMMARY_PROMPT }],
            }
        });
        const summary = res.choices[0]!.message.content;

        getContextChunks(chunks, summary);

    }
    return chunks;
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

        if(pricingTier == "basic") tier = "fast"; 
        else if(pricingTier == "max") tier = "cost_effective";
        else tier = "agentic_plus";

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
            const contextChunks: Chunk[] = await contextualRetrieval(markdown, chunks);
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