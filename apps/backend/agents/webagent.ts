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

