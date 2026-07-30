/**
 * Agentic multi-hop RAG over the user's document memory.
 * Plan sub-queries → hybrid retrieve → reason sufficiency → re-retrieve → answer.
 */
import { Annotation, START, END, StateGraph } from "@langchain/langgraph";
import { ChatOpenRouter } from "@langchain/openrouter";
import { z } from "zod";
import { hybridRetrieve, type RetrievedChunk } from "../services/hybridRetrieve.ts";
import { crossEncodeRerank } from "@repo/embed/client";
import dotenv from "dotenv";
import {
    createLangChainHandler,
    startActiveObservation,
    truncateForTrace,
    emptyTokenUsage,
    type TokenUsageSummary,
} from "@repo/langfuse/client";

dotenv.config();

const CHAT_MODEL = process.env.CHAT_MODEL ?? process.env.CONTEXT_MODEL ?? "openai/gpt-4o-mini";
const MAX_HOPS = 4;
const CHUNKS_PER_HOP = 8;
const FINAL_TOP_K = 8;

const llm = new ChatOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY!,
    model: CHAT_MODEL,
});

const HopDecisionSchema = z.object({
    enoughInformation: z.boolean(),
    nextSearchQuery: z.string().default(""),
    reasoning: z.string(),
    subQueries: z.array(z.string()).default([]),
});

type HopDecision = z.infer<typeof HopDecisionSchema>;

export type MemoryAgentProgressEvent = {
    type: "step";
    step: "start" | "plan" | "retrieve" | "reason" | "answer" | "done";
    title: string;
    detail?: string;
    query?: string;
    resultCount?: number;
    iteration?: number;
    enough?: boolean;
    reasoning?: string;
    nextQuery?: string;
};

export type GroundedSource = {
    rank: number;
    id: string;
    score: number;
    text: string;
    documentId?: string | null;
    title?: string;
    modality?: string | null;
    page?: number | null;
    timestampStart?: number | null;
    timestampEnd?: number | null;
    caption?: string | null;
    objectKey?: string | null;
    mimeType?: string | null;
};

const AgentState = Annotation.Root({
    query: Annotation<string>(),
    userId: Annotation<string>(),
    modality: Annotation<string | undefined>(),
    nextSearchQuery: Annotation<string>({
        reducer: (_p, u) => u,
        default: () => "",
    }),
    chunks: Annotation<RetrievedChunk[]>({
        reducer: (state, update) => {
            const map = new Map<string, RetrievedChunk>();
            for (const c of [...state, ...update]) {
                const prev = map.get(c.id);
                if (!prev || c.score > prev.score) map.set(c.id, c);
            }
            return Array.from(map.values()).sort((a, b) => b.score - a.score);
        },
        default: () => [],
    }),
    answer: Annotation<string>({
        reducer: (_p, u) => u,
        default: () => "",
    }),
    decision: Annotation<HopDecision | null>({
        reducer: (_p, u) => u,
        default: () => null,
    }),
    iteration: Annotation<number>({
        reducer: (_p, u) => u,
        default: () => 0,
    }),
    plannedQueries: Annotation<string[]>({
        reducer: (_p, u) => u,
        default: () => [],
    }),
});

function formatChunks(chunks: RetrievedChunk[]): string {
    if (chunks.length === 0) return "(no chunks yet)";
    return chunks
        .slice(0, 20)
        .map((c, i) => {
            const meta = [
                c.documentTitle ? `title=${c.documentTitle}` : null,
                c.modality ? `modality=${c.modality}` : null,
                c.page != null ? `page=${c.page}` : null,
                c.timestampStart != null
                    ? `t=${c.timestampStart}${c.timestampEnd != null ? `-${c.timestampEnd}` : ""}s`
                    : null,
            ]
                .filter(Boolean)
                .join(", ");
            return `[${i + 1}] id=${c.id} score=${c.score.toFixed(3)}${meta ? ` (${meta})` : ""}\n${c.text.slice(0, 600)}`;
        })
        .join("\n\n---\n\n");
}

async function planNode(state: typeof AgentState.State) {
    const structured = llm.withStructuredOutput(HopDecisionSchema);
    const result = await structured.invoke([
        {
            role: "system",
            content: `You plan multi-hop retrieval over a private document library.
Given a user question, propose 1-3 short search sub-queries that together cover the question.
Set enoughInformation=false always at plan stage. Put the primary query in nextSearchQuery.
subQueries: additional follow-up retrieval queries.`,
        },
        {
            role: "user",
            content: `Question: ${state.query}`,
        },
    ]);

    const queries = [
        result.nextSearchQuery?.trim() || state.query,
        ...(result.subQueries ?? []).map((q) => q.trim()).filter(Boolean),
    ].filter((q, i, arr) => q && arr.indexOf(q) === i);

    return {
        plannedQueries: queries.slice(0, 3),
        nextSearchQuery: queries[0] || state.query,
        decision: result,
        iteration: 0,
    };
}

async function retrieveNode(state: typeof AgentState.State) {
    const q = state.nextSearchQuery || state.query;
    const raw = await hybridRetrieve(state.userId, q, {
        limit: 40,
        modality: state.modality,
    });
    const ranked = await crossEncodeRerank(
        q,
        raw.map((c) => ({ id: c.id, text: c.text, score: c.score })),
        CHUNKS_PER_HOP
    );
    const byId = new Map(raw.map((c) => [c.id, c]));
    const hopChunks: RetrievedChunk[] = ranked.map((r) => {
        const base = byId.get(r.id);
        return {
            ...(base ?? {
                id: r.id,
                text: r.text,
                score: r.score,
            }),
            score: r.score,
            text: r.text,
            id: r.id,
        };
    });
    return {
        chunks: hopChunks,
        iteration: state.iteration + 1,
    };
}

async function reasonNode(state: typeof AgentState.State) {
    const structured = llm.withStructuredOutput(HopDecisionSchema);
    const result = await structured.invoke([
        {
            role: "system",
            content: `You are a retrieval critic for multi-hop RAG.
Decide if the accumulated chunks are enough to answer the user accurately with citations.
If not, propose nextSearchQuery that targets the missing information.
Do not invent facts. Max hops will stop you eventually.`,
        },
        {
            role: "user",
            content: `Original question: ${state.query}

Hop: ${state.iteration}/${MAX_HOPS}

Accumulated chunks:
${formatChunks(state.chunks)}

Is this enough? If not, what should we search next?`,
        },
    ]);
    return { decision: result, nextSearchQuery: result.nextSearchQuery || state.query };
}

async function answerNode(state: typeof AgentState.State) {
    const top = state.chunks.slice(0, FINAL_TOP_K);
    const response = await llm.invoke([
        {
            role: "system",
            content: `You are RecallOS. Answer using ONLY the provided chunks.
Cite sources inline as [1], [2] matching chunk ranks.
When a chunk has page or timestamp metadata, mention it (e.g. "p.3" or "at 1:24").
If insufficient, say what is missing. Be concise and accurate.`,
        },
        {
            role: "user",
            content: `Question: ${state.query}

Chunks:
${formatChunks(top)}`,
        },
    ]);
    const content = response.content;
    const answer =
        typeof content === "string"
            ? content
            : Array.isArray(content)
              ? content.map((p) => (typeof p === "string" ? p : (p as { text?: string }).text ?? "")).join("")
              : String(content ?? "");
    return { answer };
}

function shouldContinue(state: typeof AgentState.State): "retrieve" | "answer" {
    if (state.iteration >= MAX_HOPS) return "answer";
    if (state.decision?.enoughInformation) return "answer";
    if (!state.decision?.nextSearchQuery?.trim()) return "answer";
    return "retrieve";
}

const memoryGraph = new StateGraph(AgentState)
    .addNode("plan", planNode)
    .addNode("retrieve", retrieveNode)
    .addNode("reason", reasonNode)
    .addNode("answer", answerNode)
    .addEdge(START, "plan")
    .addEdge("plan", "retrieve")
    .addEdge("retrieve", "reason")
    .addConditionalEdges("reason", shouldContinue, {
        retrieve: "retrieve",
        answer: "answer",
    })
    .addEdge("answer", END)
    .compile();

export type RunMemoryAgentOptions = {
    userId: string;
    sessionId?: string;
    modality?: string;
    tags?: string[];
    onEvent?: (event: MemoryAgentProgressEvent) => void | Promise<void>;
};

export async function runMemoryAgent(
    query: string,
    options: RunMemoryAgentOptions
): Promise<{
    answer: string;
    sources: GroundedSource[];
    chunks: RetrievedChunk[];
    tokenUsage: TokenUsageSummary;
    hops: number;
}> {
    return startActiveObservation(
        "memory-agent",
        async (span) => {
            span.update({
                input: { query: truncateForTrace(query, 500) },
                metadata: { modality: options.modality ?? null },
            });

            const emit = async (event: MemoryAgentProgressEvent) => {
                try {
                    await options.onEvent?.(event);
                } catch {
                    /* ignore client emit errors */
                }
            };

            await emit({
                type: "step",
                step: "start",
                title: "Starting multi-hop memory agent…",
                query,
            });

            let hops = 0;
            let finalState: typeof AgentState.State | null = null;
            let tokenUsage: TokenUsageSummary = emptyTokenUsage();

            const handler = createLangChainHandler();

            const stream = await memoryGraph.stream(
                {
                    query,
                    userId: options.userId,
                    modality: options.modality,
                    nextSearchQuery: query,
                },
                {
                    callbacks: handler ? [handler] : undefined,
                    tags: ["memory-agent", "multi-hop", ...(options.tags ?? [])],
                    metadata: {
                        userId: options.userId,
                        sessionId: options.sessionId,
                    },
                }
            );

            for await (const update of stream) {
                if (update.plan) {
                    await emit({
                        type: "step",
                        step: "plan",
                        title: "Planned retrieval hops",
                        detail: (update.plan.plannedQueries as string[] | undefined)?.join(" · "),
                        query: update.plan.nextSearchQuery as string | undefined,
                        reasoning: (update.plan.decision as HopDecision | null)?.reasoning,
                    });
                }
                if (update.retrieve) {
                    hops = (update.retrieve.iteration as number) ?? hops + 1;
                    const chunkCount = Array.isArray(update.retrieve.chunks)
                        ? update.retrieve.chunks.length
                        : 0;
                    await emit({
                        type: "step",
                        step: "retrieve",
                        title: `Retrieved hop ${hops}`,
                        resultCount: chunkCount,
                        iteration: hops,
                        query: query,
                    });
                }
                if (update.reason) {
                    const d = update.reason.decision as HopDecision | null;
                    await emit({
                        type: "step",
                        step: "reason",
                        title: d?.enoughInformation
                            ? "Evidence sufficient"
                            : "Need another hop",
                        enough: d?.enoughInformation,
                        reasoning: d?.reasoning,
                        nextQuery: d?.nextSearchQuery,
                        iteration: hops,
                    });
                }
                if (update.answer) {
                    await emit({
                        type: "step",
                        step: "answer",
                        title: "Composing grounded answer…",
                    });
                    finalState = {
                        ...(finalState ?? {}),
                        ...update.answer,
                    } as typeof AgentState.State;
                }
                // Accumulate full state pieces
                finalState = {
                    ...(finalState ?? {
                        query,
                        userId: options.userId,
                        chunks: [],
                        answer: "",
                        decision: null,
                        iteration: 0,
                        plannedQueries: [],
                        nextSearchQuery: query,
                    }),
                    ...(update.plan ?? {}),
                    ...(update.retrieve ?? {}),
                    ...(update.reason ?? {}),
                    ...(update.answer ?? {}),
                } as typeof AgentState.State;
            }

            // Final invoke if stream didn't assemble answer
            if (!finalState?.answer) {
                const result = await memoryGraph.invoke({
                    query,
                    userId: options.userId,
                    modality: options.modality,
                    nextSearchQuery: query,
                });
                finalState = result;
                hops = result.iteration ?? hops;
            }

            const topChunks = (finalState.chunks ?? []).slice(0, FINAL_TOP_K);
            const sources: GroundedSource[] = topChunks.map((c, i) => ({
                rank: i + 1,
                id: c.id,
                score: c.score,
                text: c.text.slice(0, 450),
                documentId: c.documentId != null ? String(c.documentId) : null,
                title: c.documentTitle ?? undefined,
                modality: c.modality,
                page: c.page ?? null,
                timestampStart: c.timestampStart ?? null,
                timestampEnd: c.timestampEnd ?? null,
                caption: c.caption ?? null,
            }));

            await emit({
                type: "step",
                step: "done",
                title: "Multi-hop research complete",
                resultCount: sources.length,
                iteration: hops,
            });

            span.update({
                output: {
                    hops,
                    sourceCount: sources.length,
                    answer: truncateForTrace(finalState.answer ?? "", 2000),
                },
            });

            return {
                answer: finalState.answer || "I couldn't find enough information in your library.",
                sources,
                chunks: topChunks,
                tokenUsage,
                hops,
            };
        },
        { asType: "agent" }
    );
}
