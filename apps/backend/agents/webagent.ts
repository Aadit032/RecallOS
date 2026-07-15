import Exa from "exa-js";
import { Annotation, START, END, StateGraph } from "@langchain/langgraph";
import { ChatOpenRouter } from "@langchain/openrouter";
import { ReasoningSchema } from "../types";
import type { z } from "zod";
import dotenv from "dotenv";
import {
    createLangChainHandler,
    startActiveObservation,
    traceTokenUsageFields,
    truncateForTrace,
    type TokenUsageSummary,
} from "@repo/langfuse/client";

dotenv.config();

const WEB_MODEL = process.env.CHAT_MODEL ?? "openrouter/free";

const llm = new ChatOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY!, model: WEB_MODEL });

if (!process.env.EXA_API_KEY) console.warn("[webagent] EXA_API_KEY is not set — web search will fail at runtime");

const exa = new Exa(process.env.EXA_API_KEY);

type Decision = z.infer<typeof ReasoningSchema>;

const MAX_ITERATIONS = 5;
const RESULTS_PER_SEARCH = 5;

export type WebSearchHit = {
    title: string;
    url: string;
    text: string;
};

/** Progress events streamed to the chat UI while the graph runs. */
export type WebAgentProgressEvent =
    | {
          type: "step";
          step: "start" | "search" | "reason" | "answer" | "done";
          title: string;
          detail?: string;
          query?: string;
          resultCount?: number;
          iteration?: number;
          enough?: boolean;
          reasoning?: string;
          nextQuery?: string;
      };

const WebState = Annotation.Root({
    /** Original user question (without the /web prefix). */
    query: Annotation<string>(),
    /** Query used for the next Exa search (may be refined by the reasoner). */
    nextSearchQuery: Annotation<string>({
        reducer: (_prev, update) => update,
        default: () => "",
    }),
    /** Accumulated search hits across iterations. */
    searchResults: Annotation<WebSearchHit[]>({
        reducer: (state, update) => [...state, ...update],
        default: () => [],
    }),
    /** Final natural-language answer. */
    answer: Annotation<string>({
        reducer: (_prev, update) => update,
        default: () => "",
    }),
    /** Latest sufficiency judgment from the reasoner. */
    decision: Annotation<Decision | null>({
        reducer: (_prev, update) => update,
        default: () => null,
    }),
    /** How many reason→search cycles have completed. */
    iteration: Annotation<number>({
        reducer: (_prev, update) => update,
        default: () => 0,
    }),
});

function formatHits(hits: WebSearchHit[]): string {
    if (hits.length === 0) return "(no results yet)";
    return hits
        .map(
            (r, i) =>
                `[${i + 1}] Title: ${r.title}\nURL: ${r.url}\nContent:\n${r.text}`
        )
        .join("\n\n-----------------\n\n");
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

/** Exa search → append hits into state. */
async function searchNode(state: typeof WebState.State) {
    const searchQuery = (state.nextSearchQuery || state.query).trim();
    if (!searchQuery) {
        console.warn("[webagent:search] Empty search query — skipping Exa call");
        return { searchResults: [] as WebSearchHit[] };
    }

    console.log(`[webagent:search] iteration=${state.iteration} query="${searchQuery.slice(0, 120)}"`);

    const response = await exa.search(searchQuery, {
        numResults: RESULTS_PER_SEARCH,
        contents: { text: { maxCharacters: 2000 } },
    });

    const hits: WebSearchHit[] = (response.results ?? []).map((r) => ({
        title: r.title ?? "(untitled)",
        url: r.url ?? "",
        text: typeof r.text === "string" ? r.text : "",
    }));

    console.log(`[webagent:search] got ${hits.length} results`);
    return { searchResults: hits };
}

/**
 * LLM judges whether accumulated results are enough.
 * If not, proposes a single refined follow-up query.
 */
async function reasonNode(state: typeof WebState.State) {
    const results = formatHits(state.searchResults);
    console.log(
        `[webagent:reason] judging ${state.searchResults.length} hits (iteration ${state.iteration})`
    );

    const structured = llm.withStructuredOutput(ReasoningSchema);
    const decision = (await structured.invoke(`
        You are a web research planner.
        The user asked:
        ${state.query}

        Current search results:
        ${results}

        Determine whether these search results are sufficient to answer the user's question.

        If they are NOT sufficient:
        - Set enoughInformation=false
        - Produce ONE focused search query (nextSearchQuery) that will retrieve the missing information.

        If they ARE sufficient:
        - Set enoughInformation=true
        - Set nextSearchQuery to an empty string.

        Also write a short reasoning field explaining your judgment.
        Do not answer the user's question.
        Only determine whether more searching is required.
    `)) as Decision;

    const nextIteration = state.iteration + 1;
    console.log(
        `[webagent:reason] enough=${decision.enoughInformation} nextQuery="${(decision.nextSearchQuery ?? "").slice(0, 80)}" iteration=${nextIteration}`
    );

    return {
        decision,
        iteration: nextIteration,
        nextSearchQuery: decision.enoughInformation
            ? state.nextSearchQuery || state.query
            : (decision.nextSearchQuery || state.query).trim(),
    };
}

/** Final answer from all collected hits. */
async function answerNode(state: typeof WebState.State) {
    const context = formatHits(state.searchResults);
    console.log(
        `[webagent:answer] synthesizing answer from ${state.searchResults.length} hits`
    );

    const result = await llm.invoke(`
        You are a research assistant.
        Answer the user's question using ONLY the provided search results.
        If the results are incomplete, say what is missing rather than inventing facts.
        Be concise and accurate.

        Question:
        ${state.query}

        Search Results:
        ${context}
    `);

    return { answer: messageText(result.content) };
}

function routeAfterReason(state: typeof WebState.State): "do_search" | "write_answer" {
    if (state.decision?.enoughInformation) return "write_answer";
    if (state.iteration >= MAX_ITERATIONS) return "write_answer";
    if (!state.decision?.nextSearchQuery?.trim()) return "write_answer";
    return "do_search";
}

/**
 * Agentic web research graph:
 *
 *   START → do_search → reason ─┬─(enough / max iters)→ write_answer → END
 *                                └─(need more)─────────→ do_search ↺
 *
 * Node names must not collide with state channel keys (query, answer, …).
 */
export const webGraph = new StateGraph(WebState)
    .addNode("do_search", searchNode)
    .addNode("reason", reasonNode)
    .addNode("write_answer", answerNode)
    .addEdge(START, "do_search")
    .addEdge("do_search", "reason")
    .addConditionalEdges("reason", routeAfterReason, {
        do_search: "do_search",
        write_answer: "write_answer",
    })
    .addEdge("write_answer", END)
    .compile();

export type RunWebSearchAgentOptions = {
    onEvent?: (event: WebAgentProgressEvent) => void | Promise<void>;
    /** Langfuse / analytics context from the chat request */
    userId?: string;
    sessionId?: string;
    tags?: string[];
};

/**
 * Run the web research agent, optionally streaming graph progress via onEvent.
 * Traced as a Langfuse `agent` observation; LangGraph LLM steps use CallbackHandler.
 */
export async function runWebSearchAgent(
    query: string,
    onEventOrOptions?:
        | ((event: WebAgentProgressEvent) => void | Promise<void>)
        | RunWebSearchAgentOptions
): Promise<{
    answer: string;
    sources: WebSearchHit[];
    iterations: number;
    tokenUsage: TokenUsageSummary;
}> {
    const options: RunWebSearchAgentOptions =
        typeof onEventOrOptions === "function"
            ? { onEvent: onEventOrOptions }
            : (onEventOrOptions ?? {});
    const onEvent = options.onEvent;

    const q = query.trim();
    if (!q) {
        return {
            answer: "Please provide a search query after /web.",
            sources: [],
            iterations: 0,
            tokenUsage: { input: 0, output: 0, total: 0, cost: 0 },
        };
    }

    return startActiveObservation(
        "web-research-agent",
        async (agent) => {
            agent.update({
                input: { query: truncateForTrace(q, 500) },
                metadata: {
                    model: WEB_MODEL,
                    maxIterations: MAX_ITERATIONS,
                    resultsPerSearch: RESULTS_PER_SEARCH,
                },
            });

            const input = {
                query: q,
                nextSearchQuery: q,
                searchResults: [] as WebSearchHit[],
                answer: "",
                decision: null as Decision | null,
                iteration: 0,
            };

            await onEvent?.({
                type: "step",
                step: "start",
                title: "Starting web research agent",
                detail: "Planning search → reason → answer loop",
                query: q,
            });

            let activeQuery = q;
            let answer = "";
            const allSources: WebSearchHit[] = [];
            let iterations = 0;

            const { handler: langfuseHandler, getTokenUsage } = createLangChainHandler({
                userId: options.userId,
                sessionId: options.sessionId,
                tags: ["web-agent", "langgraph", ...(options.tags ?? [])],
                traceMetadata: { model: WEB_MODEL },
            });

            // Stream node-level updates so the UI can show each graph step live
            const stream = await webGraph.stream(input, {
                streamMode: "updates",
                callbacks: [langfuseHandler],
            });

            for await (const update of stream) {
                if (update.do_search) {
                    const hits = (update.do_search.searchResults ?? []) as WebSearchHit[];
                    allSources.push(...hits);
                    await onEvent?.({
                        type: "step",
                        step: "search",
                        title: "Searching the web",
                        query: activeQuery,
                        resultCount: hits.length,
                        detail:
                            hits.length > 0
                                ? `Found ${hits.length} result${hits.length === 1 ? "" : "s"} for “${activeQuery.slice(0, 80)}${activeQuery.length > 80 ? "…" : ""}”`
                                : `No results for “${activeQuery.slice(0, 80)}”`,
                        iteration: iterations,
                    });
                }

                if (update.reason) {
                    const decision = update.reason.decision as Decision | null | undefined;
                    iterations = (update.reason.iteration as number | undefined) ?? iterations + 1;
                    if (typeof update.reason.nextSearchQuery === "string") {
                        activeQuery = update.reason.nextSearchQuery;
                    }
                    await onEvent?.({
                        type: "step",
                        step: "reason",
                        title: decision?.enoughInformation
                            ? "Results look sufficient"
                            : "Need another search",
                        iteration: iterations,
                        enough: decision?.enoughInformation,
                        reasoning: decision?.reasoning,
                        nextQuery: decision?.enoughInformation
                            ? undefined
                            : decision?.nextSearchQuery || undefined,
                        detail: decision?.enoughInformation
                            ? "Moving on to write the answer"
                            : decision?.nextSearchQuery
                              ? `Next query: “${decision.nextSearchQuery.slice(0, 100)}”`
                              : "Refining search strategy",
                    });
                }

                if (update.write_answer) {
                    answer = (update.write_answer.answer as string) ?? "";
                    await onEvent?.({
                        type: "step",
                        step: "answer",
                        title: "Writing answer from sources",
                        detail: "Synthesizing a response with cited links",
                        iteration: iterations,
                    });
                }
            }

            const finalAnswer = answer.trim() || "I couldn't find enough information on the web to answer that.";

            await onEvent?.({
                type: "step",
                step: "done",
                title: "Web research complete",
                detail: `${allSources.length} source${allSources.length === 1 ? "" : "s"} · ${iterations} reasoning pass${iterations === 1 ? "" : "es"}`,
                iteration: iterations,
                resultCount: allSources.length,
            });

            const tokenUsage = getTokenUsage();
            const tokenFields = traceTokenUsageFields(tokenUsage);

            agent.update({
                output: {
                    answer: truncateForTrace(finalAnswer, 2_000),
                    sourceCount: allSources.length,
                    iterations,
                    ...tokenFields.output,
                },
                metadata: {
                    ...tokenFields.metadata,
                },
                ...("usageDetails" in tokenFields
                    ? {
                          usageDetails: tokenFields.usageDetails,
                          costDetails: tokenFields.costDetails,
                      }
                    : {}),
            });

            return {
                answer: finalAnswer,
                sources: allSources,
                iterations,
                tokenUsage,
            };
        },
        { asType: "agent" }
    );
}
