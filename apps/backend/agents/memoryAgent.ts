/**
 * Agentic multi-hop RAG over the user's document memory.
 * Plan sub-queries → hybrid retrieve → reason sufficiency → re-retrieve → answer.
 *
 * Node names must not collide with state channel keys (query, answer, …).
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
        reducer: (state, update) => mergeChunks(state, update),
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

function mergeChunks(
    state: RetrievedChunk[],
    update: RetrievedChunk[]
): RetrievedChunk[] {
    const map = new Map<string, RetrievedChunk>();
    for (const c of [...state, ...update]) {
        const prev = map.get(c.id);
        if (!prev || c.score > prev.score) map.set(c.id, c);
    }
    return Array.from(map.values()).sort((a, b) => b.score - a.score);
}

function messageText(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === "string") return part;
                if (part && typeof part === "object" && "text" in part) {
                    return String((part as { text?: unknown }).text ?? "");
                }
                return "";
            })
            .join("");
    }
    return String(content ?? "");
}

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
    console.log(`[memoryAgent:plan] query="${state.query.slice(0, 120)}"`);
    const structured = llm.withStructuredOutput(HopDecisionSchema);
    const result = (await structured.invoke(`
        You plan multi-hop retrieval over a private document library.
        Given a user question, propose 1-3 short search sub-queries that together cover the question.
        Set enoughInformation=false always at plan stage.
        Put the primary query in nextSearchQuery.
        subQueries: additional follow-up retrieval queries.

        Question:
        ${state.query}
    `)) as HopDecision;

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
    const q = (state.nextSearchQuery || state.query).trim() || state.query;
    console.log(
        `[memoryAgent:retrieve] hop=${state.iteration + 1} query="${q.slice(0, 120)}"`
    );

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

    console.log(`[memoryAgent:retrieve] got ${hopChunks.length} chunks (raw=${raw.length})`);
    return {
        chunks: hopChunks,
        iteration: state.iteration + 1,
    };
}

async function reasonNode(state: typeof AgentState.State) {
    console.log(
        `[memoryAgent:reason] judging ${state.chunks.length} chunks (hop ${state.iteration}/${MAX_HOPS})`
    );
    const structured = llm.withStructuredOutput(HopDecisionSchema);
    const result = (await structured.invoke(`
        You are a retrieval critic for multi-hop RAG.
        Decide if the accumulated chunks are enough to answer the user accurately with citations.
        If not, propose nextSearchQuery that targets the missing information.
        Do not invent facts. Max hops will stop you eventually.

        Original question:
        ${state.query}

        Hop: ${state.iteration}/${MAX_HOPS}

        Accumulated chunks:
        ${formatChunks(state.chunks)}

        Is this enough? If not, what should we search next?
    `)) as HopDecision;

    console.log(
        `[memoryAgent:reason] enough=${result.enoughInformation} next="${(result.nextSearchQuery ?? "").slice(0, 80)}"`
    );

    return {
        decision: result,
        nextSearchQuery: result.enoughInformation
            ? state.nextSearchQuery || state.query
            : (result.nextSearchQuery || state.query).trim(),
    };
}

async function writeAnswerNode(state: typeof AgentState.State) {
    const top = state.chunks.slice(0, FINAL_TOP_K);
    console.log(`[memoryAgent:write_answer] synthesizing from ${top.length} chunks`);
    const response = await llm.invoke(`
        You are RecallOS. Answer using ONLY the provided chunks.
        Cite sources inline as [1], [2] matching chunk ranks.
        When a chunk has page or timestamp metadata, mention it (e.g. "p.3" or "at 1:24").
        If insufficient, say what is missing. Be concise and accurate.

        Question:
        ${state.query}

        Chunks:
        ${formatChunks(top)}
    `);
    return { answer: messageText(response.content) };
}

function routeAfterReason(
    state: typeof AgentState.State
): "do_retrieve" | "write_answer" {
    if (state.iteration >= MAX_HOPS) return "write_answer";
    if (state.decision?.enoughInformation) return "write_answer";
    if (!state.decision?.nextSearchQuery?.trim()) return "write_answer";
    return "do_retrieve";
}

/**
 *   START → plan → do_retrieve → reason ─┬─(enough / max hops)→ write_answer → END
 *                                         └─(need more)─────────→ do_retrieve ↺
 */
const memoryGraph = new StateGraph(AgentState)
    .addNode("plan", planNode)
    .addNode("do_retrieve", retrieveNode)
    .addNode("reason", reasonNode)
    .addNode("write_answer", writeAnswerNode)
    .addEdge(START, "plan")
    .addEdge("plan", "do_retrieve")
    .addEdge("do_retrieve", "reason")
    .addConditionalEdges("reason", routeAfterReason, {
        do_retrieve: "do_retrieve",
        write_answer: "write_answer",
    })
    .addEdge("write_answer", END)
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
    const q = query.trim();
    if (!q) {
        return {
            answer: "Please provide a query after /agent.",
            sources: [],
            chunks: [],
            tokenUsage: emptyTokenUsage(),
            hops: 0,
        };
    }

    return startActiveObservation(
        "memory-agent",
        async (span) => {
            span.update({
                input: { query: truncateForTrace(q, 500) },
                metadata: {
                    model: CHAT_MODEL,
                    modality: options.modality ?? null,
                    maxHops: MAX_HOPS,
                },
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
                query: q,
            });

            const { handler: langfuseHandler, getTokenUsage } = createLangChainHandler({
                userId: options.userId,
                sessionId: options.sessionId,
                tags: ["memory-agent", "multi-hop", "langgraph", ...(options.tags ?? [])],
                traceMetadata: { model: CHAT_MODEL },
            });

            let hops = 0;
            let answer = "";
            let accumulatedChunks: RetrievedChunk[] = [];
            let activeQuery = q;

            const stream = await memoryGraph.stream(
                {
                    query: q,
                    userId: options.userId,
                    modality: options.modality,
                    nextSearchQuery: q,
                },
                {
                    streamMode: "updates",
                    callbacks: [langfuseHandler],
                }
            );

            for await (const update of stream) {
                if (update.plan) {
                    const planned =
                        (update.plan.plannedQueries as string[] | undefined) ?? [];
                    if (typeof update.plan.nextSearchQuery === "string") {
                        activeQuery = update.plan.nextSearchQuery;
                    }
                    await emit({
                        type: "step",
                        step: "plan",
                        title: "Planned retrieval hops",
                        detail: planned.join(" · ") || activeQuery,
                        query: activeQuery,
                        reasoning: (update.plan.decision as HopDecision | null)?.reasoning,
                    });
                }

                if (update.do_retrieve) {
                    hops =
                        typeof update.do_retrieve.iteration === "number"
                            ? update.do_retrieve.iteration
                            : hops + 1;
                    const batch = Array.isArray(update.do_retrieve.chunks)
                        ? (update.do_retrieve.chunks as RetrievedChunk[])
                        : [];
                    accumulatedChunks = mergeChunks(accumulatedChunks, batch);
                    await emit({
                        type: "step",
                        step: "retrieve",
                        title: `Retrieved hop ${hops}`,
                        resultCount: batch.length,
                        iteration: hops,
                        query: activeQuery,
                        detail: `${accumulatedChunks.length} unique chunks so far`,
                    });
                }

                if (update.reason) {
                    const d = update.reason.decision as HopDecision | null | undefined;
                    if (typeof update.reason.nextSearchQuery === "string") {
                        activeQuery = update.reason.nextSearchQuery;
                    }
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

                if (update.write_answer) {
                    await emit({
                        type: "step",
                        step: "answer",
                        title: "Composing grounded answer…",
                    });
                    if (typeof update.write_answer.answer === "string") {
                        answer = update.write_answer.answer;
                    }
                }
            }

            const topChunks = accumulatedChunks.slice(0, FINAL_TOP_K);
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

            const tokenUsage = getTokenUsage();
            span.update({
                output: {
                    hops,
                    sourceCount: sources.length,
                    answer: truncateForTrace(answer, 2000),
                },
                metadata: { model: CHAT_MODEL },
            });

            return {
                answer: answer || "I couldn't find enough information in your library.",
                sources,
                chunks: topChunks,
                tokenUsage,
                hops,
            };
        },
        { asType: "agent" }
    );
}
