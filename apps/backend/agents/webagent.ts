import Exa from "exa-js";
import { Annotation, START, END, StateGraph } from "@langchain/langgraph";
import { ChatOpenRouter } from "@langchain/openrouter";
import { ReasoningSchema } from "../types";
import type { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const WEB_MODEL =
    process.env.WEB_AGENT_MODEL ??
    process.env.CHAT_MODEL ??
    process.env.CONTEXT_MODEL ??
    "openai/gpt-4o-mini";

const llm = new ChatOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY!,
    model: WEB_MODEL,
});

if (!process.env.EXA_API_KEY) {
    console.warn("[webagent] EXA_API_KEY is not set — web search will fail at runtime");
}

const exa = new Exa(process.env.EXA_API_KEY);

type Decision = z.infer<typeof ReasoningSchema>;

const MAX_ITERATIONS = 5;
const RESULTS_PER_SEARCH = 5;

export type WebSearchHit = {
    title: string;
    url: string;
    text: string;
};

const WebState = Annotation.Root({
    query: Annotation<string>(),
    nextSearchQuery: Annotation<string>({
        reducer: (_prev, update) => update,
        default: () => "",
    }),
    searchResults: Annotation<WebSearchHit[]>({
        reducer: (state, update) => [...state, ...update],
        default: () => [],
    }),
    answer: Annotation<string>({
        reducer: (_prev, update) => update,
        default: () => "",
    }),
    decision: Annotation<Decision | null>({
        reducer: (_prev, update) => update,
        default: () => null,
    }),
    iteration: Annotation<number>({
        reducer: (_prev, update) => update,
        default: () => 0,
    }),
});

function formatHits(hits: WebSearchHit[]): string {
    if (hits.length === 0) return "(no results yet)";
    return hits
        .map((r, i) => `[${i + 1}] Title: ${r.title}\nURL: ${r.url}\nContent:\n${r.text}`)
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

async function reasonNode(state: typeof WebState.State) {
    const results = formatHits(state.searchResults);
    console.log(`[webagent:reason] judging ${state.searchResults.length} hits (iteration ${state.iteration})`);

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
    console.log(`[webagent:reason] enough=${decision.enoughInformation} nextQuery="${(decision.nextSearchQuery ?? "").slice(0, 80)}" iteration=${nextIteration}`);

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
    console.log(`[webagent:answer] synthesizing answer from ${state.searchResults.length} hits`);

    const result = await llm.invoke(`
        You are a research assistant.
        Answer the user's question using ONLY the provided search results.
        If the results are incomplete, say what is missing rather than inventing facts.
        Cite sources by title and URL when you rely on them.
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
 *
 * Invoke with: webGraph.invoke({ query: "…", nextSearchQuery: "…" })
 * Read: result.answer, result.searchResults
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


export async function runWebSearchAgent(query: string): Promise<{
    answer: string;
    sources: WebSearchHit[];
    iterations: number;
}> {
    const q = query.trim();
    if (!q) {
        return {
            answer: "Please provide a search query after /web.",
            sources: [],
            iterations: 0,
        };
    }

    const result = await webGraph.invoke({
        query: q,
        nextSearchQuery: q,
        searchResults: [],
        answer: "",
        decision: null,
        iteration: 0,
    });

    return {
        answer:
            result.answer?.trim() ||
            "I couldn't find enough information on the web to answer that.",
        sources: result.searchResults ?? [],
        iterations: result.iteration ?? 0,
    };
}
