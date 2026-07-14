import Exa from "exa-js"
import { Annotation, START, END, StateGraph } from "@langchain/langgraph";
import { ChatOpenRouter } from "@langchain/openrouter"

const llm = new ChatOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY!,
    model: "openrouter/free",
});

const exa = new Exa();

const WebState = Annotation.Root({
    query: Annotation<string>(),
    searchResults: Annotation<any[]>({
        reducer: (_, update) => update,
        default: () => [],
    }),
    answer: Annotation<string>({
        reducer: (_, update) => update,
        default: () => "",
    }),
});

async function searchNode(state: typeof WebState.State) {

    const response = await exa.searchAndContents(state.query, {
        numResults: 5,
        text: true,
    });

    return { searchResults: response.results };
}

async function answerNode(state: typeof WebState.State) {

    const context = state.searchResults
        .map((r) => { return `
            Title: ${r.title}

            URL: ${r.url}

            Content:
            ${r.text}`;
        })
        .join("\n\n-----------------\n\n");

    const result = await llm.invoke(`
        You are a research assistant.
        
        Answer the user's question only using the provided search results.
        
        Question:
        ${state.query}
        
        Search Results:
        ${context}
    `);

    return { answer: result.content as string };
}

export const webGraph = new StateGraph(WebState)
    .addNode("search", searchNode)
    .addNode("answer", answerNode)
    .addEdge(START, "search")
    .addEdge("search", "answer")
    .addEdge("answer", END)
    .compile();