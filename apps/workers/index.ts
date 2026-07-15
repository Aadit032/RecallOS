import dotenv from "dotenv";
dotenv.config();

import { initTracing, startActiveObservation, withGeneration, propagateAttributes, truncateForTrace, type OpenRouterUsageLike } from "@repo/langfuse/client";
initTracing({ serviceName: "workers" });

import { xAck, xReadGroup, xAutoClaim, xPendingRange } from "@repo/redis-stream/client"
import LlamaCloud from '@llamaindex/llama-cloud'; 
import { createParseJob, getFinishedJob } from "./parse";
import { prismaClient } from "@repo/prisma/client";
import chunkMarkdown, { type Chunk } from "./chunk"
import { getDenseVectors, getSparseVectors } from "@repo/embed/client";
import { openrouterClient } from "@repo/openrouter/client"
import { qdrantClient } from "@repo/qdrant/client";
import { v4 as uuidv4 } from "uuid"

const CONSUMER_GROUP = process.env.CONSUMER_GROUP as string;
const WORKER_ID = process.env.WORKER_ID as string;
const CONTEXT_MODEL = process.env.CONTEXT_MODEL as string;
const COLLECTION = process.env.COLLECTION as string;

export const llamaClient = new LlamaCloud({ apiKey: process.env['LLAMA_CLOUD_API_KEY'] });

const MAX_RETRIES = 10;
const IDLE_THRESHOLD_MS = 1_800_000;
const CLAIM_INTERVAL_MS = 30_000;

interface streamMessage {
    id: string,
    message: { documentId: string }
}

export type Tier = "fast" | "cost_effective" | "agentic" | "agentic_plus";

type PricingTier = "basic" | "pro" | "max"

async function claimStaleJobs() {
    console.log(`[workers:claimStaleJobs] Checking for stale jobs (idle > ${IDLE_THRESHOLD_MS}ms)`);
    const claimed = await xAutoClaim(CONSUMER_GROUP, WORKER_ID, IDLE_THRESHOLD_MS, 10);
    
    if (claimed.length === 0) {
        console.log(`[workers:claimStaleJobs] No stale jobs to claim`);
        return;
    }
    for (const msg of claimed) {
        console.log(`[workers:claimStaleJobs] Claimed message: id="${msg.id}", documentId="${msg.message.documentId}"`);
        
        const pendingInfo = await xPendingRange(CONSUMER_GROUP, msg.id, msg.id, 1);
        const deliveryCount = pendingInfo?.[0]?.deliveryCount ?? 1;

        if (deliveryCount > MAX_RETRIES) {
            console.log(`[workers:claimStaleJobs] deliveryCount ${deliveryCount} > MAX_RETRIES ${MAX_RETRIES} — FAILING document ${msg.message.documentId}`);
            try {
                await prismaClient.document.update({
                    where: { id: msg.message.documentId },
                    data: { status: "FAILED" },
                });
            } catch (e) {
                console.log(`[workers:claimStaleJobs] Could not mark FAILED (doc may be deleted):`, e);
            }

            await xAck(CONSUMER_GROUP, msg.id);

        } else {
            console.log(`[workers:claimStaleJobs] deliveryCount ${deliveryCount} <= ${MAX_RETRIES} — processing document ${msg.message.documentId}`);
        
            try {
                await processDocuments(msg, "basic");
                await xAck(CONSUMER_GROUP, msg.id);
            } catch (e) {
                console.log(`[workers:claimStaleJobs] Error processing claimed document:`, e);
            }
        }
    }
}

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

            console.log("======== WORKERS DONE!! =========");
        }catch(e){
            console.log("Error while running workers: ", e instanceof Error ? e.message : e);
        }
    }
}

async function getContextChunks(chunks: Chunk[], full_doc: string): Promise<Chunk[]>{
    return startActiveObservation("contextualize-chunks", async (span) => {
        span.update({
            input: { chunkCount: chunks.length, docChars: full_doc.length },
            metadata: { model: CONTEXT_MODEL },
        });

        const contextualized = await Promise.all(chunks.map(async (chunk) => {
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

            try {
                const content = await withGeneration(
                    "contextualize-chunk",
                    {
                        model: CONTEXT_MODEL,
                        input: {
                            chunkId: chunk.id,
                            chunkPreview: truncateForTrace(chunk.text, 300),
                        },
                        metadata: { feature: "contextual-retrieval" },
                    },
                    async () => {
                        const response = await openrouterClient.chat.send({
                            chatRequest: {
                                model: CONTEXT_MODEL,
                                messages: [{ role: 'user', content: CONTEXT_PROMPT }],
                            }
                        });
                        const text = response?.choices[0]?.message.content ?? "";
                        return {
                            output: text,
                            usage: (response as { usage?: OpenRouterUsageLike }).usage,
                        };
                    }
                );

                if (!content) {
                    console.log("No response from openrouter for contextual retrieval on chunk; keeping original text.");
                    return chunk;
                }

                return { ...chunk, text: content };
            } catch (e) {
                console.log("Contextual retrieval failed for chunk; keeping original text.", e);
                return chunk;
            }
        }));

        span.update({ output: { chunkCount: contextualized.length } });
        return contextualized;
    });
}

async function contextualRetrieval(full_doc: string, chunks: Chunk[]): Promise<Chunk[]>{
    const isSmall = full_doc.length < 5000 ? true : false;

    if(isSmall){
        return await getContextChunks(chunks, full_doc);
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

        const summary = await withGeneration(
            "summarize-document",
            {
                model: CONTEXT_MODEL,
                input: {
                    docChars: full_doc.length,
                    promptPreview: truncateForTrace(SUMMARY_PROMPT, 500),
                },
                metadata: { feature: "contextual-retrieval" },
            },
            async () => {
                const res = await openrouterClient.chat.send({
                    chatRequest: {
                        model: CONTEXT_MODEL,
                        messages: [{ role: 'user', content: SUMMARY_PROMPT }],
                    }
                });
                return {
                    output: res.choices[0]?.message.content ?? "",
                    usage: (res as { usage?: OpenRouterUsageLike }).usage,
                };
            }
        );
        if (!summary) {
            console.log("No summary returned from openrouter; falling back to full document for context.");
            return await getContextChunks(chunks, full_doc);
        }

        return await getContextChunks(chunks, summary);
    }
}

async function documentStillExists(documentId: string): Promise<boolean> {
    const row = await prismaClient.document.findUnique({
        where: { id: documentId },
        select: { id: true },
    });
    return Boolean(row);
}

async function upsertChunks(chunks: Chunk[], documentId: string): Promise<Boolean> {
    return startActiveObservation(
        "embed-and-upsert",
        async (span) => {
            span.update({
                input: { documentId, chunkCount: chunks.length },
                metadata: { collection: COLLECTION },
            });

            const texts = chunks.map(chunk => chunk.text)

            try{
                const sparseVectors = await startActiveObservation(
                    "sparse-embed",
                    async (emb) => {
                        emb.update({ input: { count: texts.length }, model: "splade-pp-en-v1" });
                        const vectors = await getSparseVectors(texts);
                        emb.update({ output: { count: vectors.length } });
                        return vectors;
                    },
                    { asType: "embedding" }
                );
                const embeddings = await startActiveObservation(
                    "dense-embed",
                    async (emb) => {
                        emb.update({ input: { count: texts.length }, model: "bge-small-en" });
                        const vectors = await getDenseVectors(texts);
                        emb.update({
                            output: {
                                count: vectors.length,
                                dims: vectors[0]?.length ?? 0,
                            },
                        });
                        return vectors;
                    },
                    { asType: "embedding" }
                );

                console.dir(sparseVectors[0], { depth: null });
                console.log("checking embedding size before upsert: ", embeddings[0]!.length);

                const points = chunks.map((chunk, i) => ({
                    id: uuidv4(),
                    vector: {
                        dense: Array.from(embeddings[i]!),
                        splade: {
                            indices: Array.from(sparseVectors[i]!.indices),
                            values: Array.from(sparseVectors[i]!.values),
                        },
                    },
                    payload: {
                        text: chunk.text,
                        documentId,
                        chunkIndex: chunk.id,
                    }
                }));

                console.log(points[0], { depth: null });

                await qdrantClient.upsert(COLLECTION, { wait: true, points });
                console.log("points have been upserted to qdrant!!")
                span.update({ output: { upserted: points.length, success: true } });
                return true;
            }catch (e: any) {
                console.dir(e, { depth: null });

                console.log("====== RESPONSE ======");
                console.dir(e.response, { depth: null });

                console.log("====== DATA ======");
                console.dir(e.response?.data, { depth: null });

                console.log("====== BODY ======");
                console.dir(e.response?.body, { depth: null });

                console.log("====== STATUS ======");
                console.dir(e.data?.status, { depth: null });

                span.update({
                    level: "ERROR",
                    statusMessage: e instanceof Error ? e.message : String(e),
                    output: { success: false },
                });
                return false;
            }
        }
    );
}

// parse => chunk => enrich context => get embeddings => store in vector db + splade index
async function processDocuments(streamMessage: streamMessage, pricingTier: PricingTier){
    console.log("streamMessage: ", streamMessage);
    const documentId = streamMessage.message.documentId;

    return startActiveObservation(
        "process-document",
        async (root) => {
            root.update({
                input: {
                    documentId,
                    streamId: streamMessage.id,
                    pricingTier,
                },
            });

            return propagateAttributes(
                {
                    tags: ["ingest", "document-pipeline", pricingTier],
                    metadata: {
                        documentId,
                        workerId: WORKER_ID ?? "",
                        feature: "document-ingest",
                    },
                },
                async () => {
    try{
        // Skip if document was deleted before we started
        const existing = await prismaClient.document.findUnique({
            where: { id: documentId },
            select: { id: true, ObjectKey: true },
        });
        if (!existing) {
            console.log(`[processDocuments] Document ${documentId} no longer exists — skipping`);
            root.update({ output: { skipped: true, reason: "deleted" } });
            return;
        }

        const document = await prismaClient.document.update({
            where: { id: documentId },
            data: { status: "PROCESSING" },
            select: { ObjectKey: true }
        });
        console.log("Document status updated to PROCESSING in db.")

        // Parse the document into markdown
        let markdown: string | null = null;
        let tier: Tier;

        if(pricingTier == "basic") tier = "cost_effective";
        else if(pricingTier == "max") tier = "agentic";
        else tier = "agentic_plus";

        await startActiveObservation("parse-document", async (parseSpan) => {
            parseSpan.update({
                input: { objectKey: document.ObjectKey, tier },
            });

            for(let i = 0; i < MAX_RETRIES; i++){
                if (!(await documentStillExists(documentId))) {
                    console.log(`[processDocuments] Document ${documentId} deleted during parse — aborting`);
                    parseSpan.update({ output: { aborted: true, reason: "deleted" } });
                    return;
                }
                try{
                    const job = await createParseJob(document.ObjectKey, tier, "dev");
                    if(!job) {
                        console.log("Failed to create a parsing job...");
                        parseSpan.update({ level: "ERROR", output: { error: "job-create-failed" } });
                        return;
                    }

                    markdown = await getFinishedJob(job);

                    if (markdown) {
                        parseSpan.update({
                            output: {
                                chars: markdown.length,
                                attempts: i + 1,
                            },
                        });
                        break;
                    }
                    else if(typeof markdown == null) break;

                    console.log(`Attempt ${i + 1} failed. Retrying...`);

                    await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
                }catch(e){
                    console.log("Error while getting parsed response from Llama: ", e);
                }
            }
        });

        if(!markdown){
            if (await documentStillExists(documentId)) {
                await prismaClient.document.update({
                    where: { id: documentId },
                    data: { status: "FAILED" },
                });
            }
            console.log("Max attempts reached.");
            root.update({
                level: "ERROR",
                output: { status: "FAILED", reason: "parse-failed" },
            });
            return;
        }

        if (!(await documentStillExists(documentId))) {
            console.log(`[processDocuments] Document ${documentId} deleted after parse — aborting`);
            root.update({ output: { skipped: true, reason: "deleted-after-parse" } });
            return;
        }

        // Chunk the parsed document
        let chunks: Chunk[] = await startActiveObservation("chunk-document", async (chunkSpan) => {
            const result = chunkMarkdown(markdown!);
            chunkSpan.update({
                input: { markdownChars: markdown!.length },
                output: { chunkCount: result.length },
            });
            return result;
        });

        console.log("Number of chunks: ", chunks.length);
        console.log("Example chunk text: ", chunks[0]!.text);

        // Add context to every chunk
        if(pricingTier !== "basic"){
            chunks = await contextualRetrieval(markdown, chunks);
        }

        if (!(await documentStillExists(documentId))) {
            console.log(`[processDocuments] Document ${documentId} deleted before upsert — aborting`);
            root.update({ output: { skipped: true, reason: "deleted-before-upsert" } });
            return;
        }

        // get embeddings + store in qdrant + splade idx
        const isUpserted = await upsertChunks(chunks, documentId);
        if(!isUpserted){
            await prismaClient.document.update({
                where: { id: documentId },
                data: { status: "FAILED" }  
            });
            console.log(`[processDocuments] Document ${documentId} could not be upserted — marking as FAILED`);
            root.update({
                level: "ERROR",
                output: { status: "FAILED", reason: "upsert-failed", chunkCount: chunks.length },
            });
            return;
        }

        if (!(await documentStillExists(documentId))) {
            console.log(`[processDocuments] Document ${documentId} deleted after upsert — not marking COMPLETED`);
            root.update({ output: { skipped: true, reason: "deleted-after-upsert" } });
            return;
        }

        await prismaClient.document.update({
            where: { id: documentId },
            data: { status: "COMPLETED" }
        });

        root.update({
            output: {
                status: "COMPLETED",
                chunkCount: chunks.length,
                pricingTier,
            },
        });

    }catch(e){
        console.log("Failed processing documents. Error: ", e instanceof Error? e.message : e);
        root.update({
            level: "ERROR",
            statusMessage: e instanceof Error ? e.message : String(e),
            output: { status: "ERROR" },
        });
    }
                }
            );
        },
        { asType: "chain" }
    );
}

// ========== RUN WORKERS ============
setInterval(claimStaleJobs, CLAIM_INTERVAL_MS);
await workers();