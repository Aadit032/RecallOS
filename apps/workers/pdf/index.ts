import dotenv from "dotenv";
dotenv.config();

import { 
    initTracing, 
    startActiveObservation, 
    withGeneration, 
    propagateAttributes, 
    truncateForTrace, 
    type OpenRouterUsageLike 
} from "@repo/langfuse/client";
initTracing({ serviceName: "pdf-worker" });

import { 
    ensureStream, 
    xReadGroupFromStream, 
    xAckOnStream, 
    xAddToStream, 
} from "@repo/redis-stream/client";
import { startClaimLoop } from "../common/claimStaleJobs.ts";
import { createParseJob, getFinishedJob } from "../parse.ts";
import { prismaClient } from "@repo/prisma/client";
import chunkMarkdown, { type Chunk } from "../chunk.ts"
import { openrouterClient } from "@repo/openrouter/client"
import { type Tier } from "../index.ts";

const PDF_STREAM = process.env.PDF_STREAM as string;
const PDF_GROUP = process.env.PDF_GROUP as string;
const EMBED_STREAM = process.env.EMBED_STREAM as string;
const EMBED_GROUP = process.env.EMBED_GROUP as string;
const DLQ_STREAM = process.env.DLQ_STREAM as string;
const DLQ_GROUP = process.env.DLQ_GROUP as string;

const WORKER_ID = process.env.WORKER_ID as string;
const CONTEXT_MODEL = process.env.CONTEXT_MODEL as string;

const MAX_RETRIES = 10;
const IDLE_THRESHOLD_MS = 30 * 60 * 1000;
const CLAIM_INTERVAL_MS = 30 * 1000;

type PricingTier = "basic" | "pro" | "max";

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

export async function processPdfDocument(docId: string, pricingTier: PricingTier = "basic") {
    return startActiveObservation(
        "process-document",
        async (root) => {
            root.update({ input: { documentId: docId, pricingTier } });

            return propagateAttributes(
                {
                    tags: ["ingest", "pdf-pipeline", pricingTier],
                    metadata: { documentId: docId, workerId: WORKER_ID ?? "", feature: "document-ingest" },
                },
                async () => {
                    try {
                        const existing = await prismaClient.document.findUnique({
                            where: { id: docId },
                            select: { id: true, ObjectKey: true, userId: true, mimeType: true },
                        });
                        if (!existing) {
                            console.log(`[pdf-worker] Document ${docId} no longer exists — skipping`);
                            root.update({ output: { skipped: true, reason: "deleted" } });
                            return;
                        }

                        const document = await prismaClient.document.update({
                            where: { id: docId },
                            data: { status: "PARSING" },
                            select: { ObjectKey: true, userId: true }
                        });
                        console.log(`[pdf-worker] Document ${docId} status → PARSING`);

                        let markdown: string | null = null;
                        let tier: Tier = "cost_effective";

                        await startActiveObservation("parse-document", async (parseSpan) => {
                            parseSpan.update({ input: { objectKey: document.ObjectKey, tier } });

                            for (let i = 0; i < MAX_RETRIES; i++) {
                                if (!(await documentStillExists(docId))) {
                                    console.log(`[pdf-worker] Document ${docId} deleted during parse — aborting`);
                                    parseSpan.update({ output: { aborted: true, reason: "deleted" } });
                                    return;
                                }
                                try {
                                    const job = await createParseJob(document.ObjectKey, tier, "dev");
                                    if (!job) {
                                        console.log("Failed to create a parsing job...");
                                        parseSpan.update({ level: "ERROR", output: { error: "job-create-failed" } });
                                        return;
                                    }
                                    markdown = await getFinishedJob(job);
                                    if (markdown) {
                                        parseSpan.update({ output: { chars: markdown.length, attempts: i + 1 } });
                                        break;
                                    }
                                    console.log(`Attempt ${i + 1} failed. Retrying...`);
                                    await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
                                } catch (e) {
                                    console.log("Error while getting parsed response from Llama: ", e);
                                }
                            }
                        });

                        if (!markdown) {
                            if (await documentStillExists(docId)) {
                                await prismaClient.document.update({
                                    where: { id: docId },
                                    data: { status: "FAILED" },
                                });
                            }
                            console.log("Max attempts reached.");
                            root.update({ level: "ERROR", output: { status: "FAILED", reason: "parse-failed" } });
                            return;
                        }

                        if (!(await documentStillExists(docId))) {
                            console.log(`[pdf-worker] Document ${docId} deleted after parse — aborting`);
                            root.update({ output: { skipped: true, reason: "deleted-after-parse" } });
                            return;
                        }

                        let chunks: Chunk[] = await startActiveObservation("chunk-document", async (chunkSpan) => {
                            const result = chunkMarkdown(markdown!);
                            chunkSpan.update({ input: { markdownChars: markdown!.length }, output: { chunkCount: result.length } });
                            return result;
                        });

                        console.log(`[pdf-worker] Chunks: ${chunks.length}`);

                        if (pricingTier !== "basic") {
                            chunks = await contextualRetrieval(markdown, chunks);
                        }

                        if (!(await documentStillExists(docId))) {
                            console.log(`[pdf-worker] Document ${docId} deleted before saving chunks — aborting`);
                            root.update({ output: { skipped: true, reason: "deleted-before-save" } });
                            return;
                        }

                        // Create ParsedChunkSet + ParsedChunks in DB
                        const chunkSet = await prismaClient.parsedChunkSet.create({
                            data: {
                                documentId: docId,
                                modality: "pdf",
                                status: "PARSED",
                                chunks: {
                                    create: chunks.map(chunk => ({
                                        text: chunk.text,
                                        metadata: { chunkIndex: chunk.id },
                                    })),
                                },
                            },
                        });

                        await prismaClient.document.update({
                            where: { id: docId },
                            data: { status: "PARSED" },
                        });

                        // Push to embed_stream for embedding
                        const msgId = await xAddToStream(EMBED_STREAM, { chunkSetId: chunkSet.id });

                        console.log(`[pdf-worker] Pushed chunkSetId="${chunkSet.id}" to embed_stream (msgId=${msgId})`);
                        root.update({
                            output: {
                                status: "PARSED",
                                chunkCount: chunks.length,
                                chunkSetId: chunkSet.id,
                                pricingTier,
                            },
                        });
                    } catch (e) {
                        console.log("Failed processing PDF document. Error: ", e instanceof Error ? e.message : e);
                        root.update({
                            level: "ERROR",
                            statusMessage: e instanceof Error ? e.message : String(e),
                            output: { status: "ERROR" },
                        });

                        // Move to DLQ on repeated failure
                        await xAddToStream(DLQ_STREAM, { docId });
                    }
                }
            );
        },
        { asType: "chain" }
    );
}

export async function pdfWorkerLoop() {
    console.log(`[pdf-worker] Started — listening on "${PDF_STREAM}"`);

    while (true) {
        const msg = await xReadGroupFromStream(PDF_STREAM, PDF_GROUP, WORKER_ID, 1, 5000);
        if (!msg) continue;

        const docId = msg.message.docId as string;
        console.log(`[pdf-worker] Received docId="${docId}"`);

        try {
            await processPdfDocument(docId, "basic");
            await xAckOnStream(PDF_STREAM, PDF_GROUP, msg.id);
            console.log("======== PDF WORKER DONE =========");
        } catch (e) {
            console.log("Error in pdf worker: ", e instanceof Error ? e.message : e);
        }
    }
}

if (import.meta.path === Bun.main) {
    await ensureStream(PDF_STREAM, PDF_GROUP);
    await Promise.all([
        pdfWorkerLoop(),
        startClaimLoop({
            stream: PDF_STREAM,
            group: PDF_GROUP,
            workerId: WORKER_ID,
            dlqStream: DLQ_STREAM,
            idleThresholdMs: IDLE_THRESHOLD_MS,
            maxRetries: MAX_RETRIES,
            processFn: async (p) => processPdfDocument(p.docId as string, "basic"),
        }, CLAIM_INTERVAL_MS),
    ]);
}
