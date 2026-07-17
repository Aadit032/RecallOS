import { Router, type Response } from "express";
import { z } from "zod";
import { qdrantClient } from "@repo/qdrant/client";
import { prismaClient } from "@repo/prisma/client";
import { getDenseVectors, getSparseVectors, crossEncodeRerank } from "@repo/embed/client";
import { openrouterClient } from "@repo/openrouter/client";
import { messageSchema, bodySchema } from "../types"
import dotenv from "dotenv";
import type { JsonValue } from "../../../packages/db/generated/prisma/internal/prismaNamespace";
import { runWebSearchAgent } from "../agents/webagent"
import {
    startActiveObservation,
    propagateAttributes,
    withGeneration,
    withStreamingGeneration,
    truncateForTrace,
    traceTokenUsageFields,
    mergeTokenUsage,
    emptyTokenUsage,
    type OpenRouterUsageLike,
    type TokenUsageSummary,
} from "@repo/langfuse/client";

dotenv.config();

const chatRouter = Router();

const COLLECTION = process.env.COLLECTION as string;
const CHAT_MODEL = process.env.CHAT_MODEL ?? process.env.CONTEXT_MODEL ?? "openai/gpt-4o-mini";
const RETRIEVAL_LIMIT = 50;
const RERANK_TOP_K = 5;

type RetrievedChunk = {
    id: string;
    text: string;
    score: number;
    documentId?: string | number | null;
};

/**
 * Hybrid retrieval: dense (cosine) top-50 + sparse (SPLADE) top-50,
 * fused with Reciprocal Rank Fusion in Qdrant → top 50.
 * Scoped to the requesting user's chunks only.
 */
async function hybridRetrieve(userId: string, query: string): Promise<RetrievedChunk[]> {
    return startActiveObservation(
        "hybrid-retrieve",
        async (retriever) => {
            retriever.update({
                input: { userId, query: truncateForTrace(query, 500) },
                metadata: {
                    collection: COLLECTION,
                    limit: RETRIEVAL_LIMIT,
                    fusion: "rrf",
                },
            });

            const ownedDocuments = await prismaClient.document.findMany({
                where: { userId },
                select: { id: true },
            });
            const ownedDocumentIds = ownedDocuments.map((doc) => doc.id);
            if (ownedDocumentIds.length === 0) {
                console.log(`[hybridRetrieve] No documents for userId=${userId}, skipping retrieval`);
                retriever.update({ output: { chunkCount: 0, reason: "no-documents" } });
                return [];
            }

            const filter = { must: [{ key: "documentId", match: { any: ownedDocumentIds } }] };

            console.log(`[hybridRetrieve] Starting retrieval for userId=${userId}, query: "${query.slice(0, 120)}"`);
            const [denseVectors, sparseVectors] = await Promise.all([
                getDenseVectors([query]),
                getSparseVectors([query]),
            ]);
            console.log(`[hybridRetrieve] Dense vector dims: ${denseVectors[0]?.length ?? 0}, Sparse vector nnz: ${sparseVectors[0]?.indices?.length ?? 0}`);

            const denseVector = denseVectors[0];
            const sparse = sparseVectors[0];

            if (!denseVector || !sparse) {
                console.error("[hybridRetrieve] Failed to embed query — no vectors returned");
                throw new Error("Failed to embed query");
            }

            // Build sparse query — ensure sorted indices (Qdrant requires ascending order)
            const rawIndices = Array.from(sparse.indices as Iterable<number>);
            const rawValues = Array.from(sparse.values as Iterable<number>);
            const paired = rawIndices.map((idx, i) => ({ idx, val: rawValues[i] ?? 0 }))
                .filter(p => p.val !== 0)
                .sort((a, b) => a.idx - b.idx);
            const sparseQuery = {
                indices: paired.map(p => p.idx),
                values: paired.map(p => p.val),
            };

            const denseQuery = Array.from(denseVector as ArrayLike<number>);

            // Validate vectors before sending to Qdrant
            if (denseQuery.some(v => !Number.isFinite(v))) {
                console.error("[hybridRetrieve] Dense vector contains NaN or Infinity");
                throw new Error("Dense vector contains invalid values");
            }
            if (sparseQuery.indices.length === 0) {
                console.error("[hybridRetrieve] Sparse vector has no non-zero entries");
                throw new Error("Sparse vector is empty");
            }

            console.log(`[hybridRetrieve] Querying Qdrant collection "${COLLECTION}" with dense (${denseQuery.length}d) + sparse (${sparseQuery.indices.length} nnz) RRF, limit=${RETRIEVAL_LIMIT}, userId=${userId}, documents=${ownedDocumentIds.length}`);
            let res;
            try {
                res = await qdrantClient.query(COLLECTION, {
                    prefetch: [
                        {
                            query: denseQuery,
                            using: "dense",
                            limit: RETRIEVAL_LIMIT,
                            filter,
                        },
                        {
                            query: sparseQuery,
                            using: "splade",
                            limit: RETRIEVAL_LIMIT,
                            filter,
                        },
                    ],
                    query: { fusion: "rrf" },
                    limit: RETRIEVAL_LIMIT,
                    filter,
                    with_payload: true,
                });
            } catch (qdrantErr: any) {
                console.error(`[hybridRetrieve] Qdrant query failed:`, {
                    message: qdrantErr.message,
                    status: qdrantErr.status,
                    statusText: qdrantErr.statusText,
                    data: JSON.stringify(qdrantErr.data),
                });
                throw qdrantErr;
            }

            const rawChunks = (res.points ?? []).map((point) => {
                const payload = (point.payload ?? {}) as Record<string, unknown>;
                return {
                    id: String(point.id),
                    text: typeof payload.text === "string" ? payload.text : "",
                    score: point.score ?? 0,
                    documentId: (payload.documentId as string | number | undefined) ?? null,
                    payloadUserId: typeof payload.userId === "string" ? payload.userId : null,
                };
            }).filter((c) => c.text.length > 0);

            const ownedDocumentIdSet = new Set(ownedDocumentIds);

            const chunks = rawChunks
                .filter((c) => {
                    const docId = c.documentId == null ? null : String(c.documentId);
                    if (!docId || !ownedDocumentIdSet.has(docId)) return false;
                    return c.payloadUserId == null || c.payloadUserId === userId;
                })
                .map(({ payloadUserId: _payloadUserId, ...chunk }) => chunk);

            console.log(
                `[hybridRetrieve] Qdrant returned ${res.points?.length ?? 0} RRF points, ${chunks.length} user-scoped chunks with text`
            );

            retriever.update({
                output: {
                    chunkCount: chunks.length,
                    topScores: chunks.slice(0, 5).map((c) => ({
                        id: c.id,
                        score: c.score,
                    })),
                },
            });

            return chunks;
        },
        { asType: "retriever" }
    );
}

async function buildSystemPrompt(
    userId: string,
    chatId: string,
    contextChunks: { text: string; id: string }[],
    projectSystemPrompt?: string | null,
    userAgent?: string | null
): Promise<string> {
    console.log(`[buildSystemPrompt] Building prompt with ${contextChunks.length} context chunks`);
    const context = contextChunks
        .map((c, i) => `[${i + 1}] (id: ${c.id})\n${c.text}`)
        .join("\n\n---\n\n");

    const totalChars = context.length;
    console.log(`[buildSystemPrompt] Context length: ${totalChars} characters`);

    const projectBlock =
        projectSystemPrompt && projectSystemPrompt.trim().length > 0
            ? `\n\nAdditional project instructions:\n${projectSystemPrompt.trim()}\n`
            : "";

    const deviceBlock =
        userAgent && userAgent.trim().length > 0
            ? `\n\nClient device / browser (from User-Agent; use only when relevant to the answer, e.g. OS- or browser-specific guidance):\n${userAgent.trim()}\n`
            : "";

    const responses = await prismaClient.chat.findMany({
        where: { userId, id: { not: chatId }, summary: { not: null } },
        orderBy: { updatedAt: "desc" },
        take: 3,
        select: { summary: true }
    });

    let finalSummary = responses.map(r => r.summary)
    .filter((s): s is string => s !== null) 
    .join("\n");

    console.log(`[buildSystemPrompt] finalSummary: ${finalSummary}`);

    return `You are RecallOS, an assistant that answers questions using the user's organizational knowledge base.
        Use ONLY the context chunks below to answer. If the context is insufficient, say so clearly.
        Be concise and accurate.
        
        Recent conversation summaries: 
        ${finalSummary || "None"} 
        
        ${projectBlock}${deviceBlock}

        Context chunks:
        ${context || "(No relevant chunks found.)"}`;
}

function titleFromMessage(message: string): string {
    const trimmed = message.trim().replace(/\s+/g, " ");
    const title = trimmed.length <= 48 ? trimmed : `${trimmed.slice(0, 48)}…`;
    console.log(`[titleFromMessage] Generated title: "${title}"`);
    return title;
}


/**
 * List chats for the authenticated user (paginated, no messages).
 * Query: ?limit=20&cursor=<chatId>
 * Returns chat metadata + messageCount; load messages via GET /:id.
 */
chatRouter.get("/", async (req, res) => {
    const userId = req.userId;
    console.log(`[GET /chats] userId=${userId}`);
    if (!userId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }

    const limitSchema = z.object({
        limit: z.coerce.number().int().min(1).max(50).default(20),
        cursor: z.string().uuid().optional(),
    });
    const parsed = limitSchema.safeParse(req.query);
    if (!parsed.success) {
        console.warn(`[GET /chats] Invalid query params: ${JSON.stringify(req.query)}`);
        res.status(422).json({ message: "Invalid query", error: parsed.error });
        return;
    }

    const { limit, cursor } = parsed.data;
    console.log(`[GET /chats] Fetching chats: limit=${limit}, cursor=${cursor ?? "none"}`);

    try {
        const rows = await prismaClient.chat.findMany({
            where: { userId },
            orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
            take: limit + 1,
            ...(cursor
                ? {
                      cursor: { id: cursor },
                      skip: 1,
                  }
                : {}),
            select: {
                id: true,
                title: true,
                pinned: true,
                projectId: true,
                updatedAt: true,
                createdAt: true,
                project: { select: { id: true, name: true } },
                _count: { select: { messages: true } },
            },
        });

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const nextCursor = hasMore ? page[page.length - 1]!.id : null;

        const chats = page.map(({ _count, project, ...chat }) => ({
            ...chat,
            projectName: project?.name ?? null,
            messageCount: _count.messages,
        }));

        res.status(200).json({ chats, nextCursor, hasMore });
    } catch (e) {
        console.error("List chats error:", e);
        res.status(500).json({
            message: "Failed to list chats",
            error: e instanceof Error ? e.message : e,
        });
    }
});


chatRouter.get("/:id", async (req, res) => {
    const userId = req.userId;
    const id = req.params.id;
    console.log(`[GET /chat/:id] userId=${userId}, chatId=${id}`);

    try {
        const chat = await prismaClient.chat.findFirst({
            where: { id, userId },
            include: {
                messages: {
                    orderBy: { createdAt: "asc" },
                    select: { id: true, role: true, content: true, sourceChunks: true, createdAt: true },
                },
                project: { select: { id: true, name: true } },
            },
        });

        if (!chat) {
            console.warn(`[GET /chat/:id] Chat not found: ${id}`);
            res.status(404).json({ message: "Chat not found" });
            return;
        }

        console.log(`[GET /chat/:id] Found chat: "${chat.title}", ${chat.messages?.length ?? 0} messages`);
        res.status(200).json({ chat });
    } catch (e) {
        console.error(`[GET /chat/:id] Error for chat ${id}:`, e);
        res.status(500).json({
            message: "Failed to get chat",
            error: e instanceof Error ? e.message : e,
        });
    }
});


chatRouter.patch("/:id", async (req, res) => {
    const userId = req.userId;
    const id = req.params.id;
    console.log(`[PATCH /chat/:id] userId=${userId}, chatId=${id}, body=${JSON.stringify(req.body)}`);
    if (!userId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
        console.warn(`[PATCH /chat/:id] Invalid body for chat ${id}:`, parsed.error);
        res.status(422).json({ message: "Invalid input", error: parsed.error });
        return;
    }

    try {
        const existing = await prismaClient.chat.findFirst({ where: { id, userId } });
        if (!existing) {
            console.warn(`[PATCH /chat/:id] Chat not found: ${id}`);
            res.status(404).json({ message: "Chat not found" });
            return;
        }

        const { projectId, ...rest } = parsed.data;

        if (projectId !== undefined && projectId !== null) {
            const project = await prismaClient.project.findFirst({
                where: { id: projectId, userId },
            });
            if (!project) {
                res.status(404).json({ message: "Project not found" });
                return;
            }
        }

        console.log(`[PATCH /chat/:id] Existing title: "${existing.title}", updating with:`, parsed.data);
        const chat = await prismaClient.chat.update({
            where: { id },
            data: {
                ...rest,
                ...(projectId !== undefined ? { projectId } : {}),
            },
            include: { project: { select: { id: true, name: true } } },
        });

        console.log(`[PATCH /chat/:id] Updated chat: "${chat.title}"`);
        res.status(200).json({ chat });
    } catch (e) {
        console.error(`[PATCH /chat/:id] Error for chat ${id}:`, e);
        res.status(500).json({
            message: "Failed to update chat",
            error: e instanceof Error ? e.message : e,
        });
    }
});


chatRouter.delete("/:id", async (req, res) => {
    const userId = req.userId;
    const id = req.params.id;
    console.log(`[DELETE /chat/:id] userId=${userId}, chatId=${id}`);
    if (!userId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }

    try {
        const existing = await prismaClient.chat.findFirst({ where: { id, userId } });
        if (!existing) {
            console.warn(`[DELETE /chat/:id] Chat not found: ${id}`);
            res.status(404).json({ message: "Chat not found" });
            return;
        }

        console.log(`[DELETE /chat/:id] Deleting chat "${existing.title}" (${id})`);
        await prismaClient.chat.delete({ where: { id } });
        console.log(`[DELETE /chat/:id] Deleted chat ${id}`);
        res.status(200).json({ message: "Chat deleted" });
    } catch (e) {
        console.error(`[DELETE /chat/:id] Error:`, e);
        res.status(500).json({
            message: "Failed to delete chat",
            error: e instanceof Error ? e.message : e,
        });
    }
});

/**
 * Send a message. Creates a new chat session on the first message when chatId is omitted.
 * Pipeline: embed → dense+sparse top-50 → RRF top-50 → cross-encoder top-5 → LLM.
 */

interface Message {
    id: string
    role: string
    content: string
    sourceChunks: JsonValue
    createdAt: Date
}

async function summarizeChat(currentSummary: string | null, messages: Message[], isFirst: boolean): Promise<string>{
    let chatHistory: string = ""
    for (const m of messages){
        chatHistory += `role: ${m.role}\n` + `\ncontent: ${m.content}\n\n`;
    }

    const summaryModel = CHAT_MODEL;

    const summaryPrompt = isFirst ? `You are summarizing a conversation for future AI context.
        Your goal is to produce a concise summary that helps another AI continue the conversation without reading the full transcript.

        Include only information that is likely to matter in future conversations:
        - The user's goals, plans, and ongoing projects.
        - Important decisions that were made.
        - Important facts the user shared during this conversation.
        - Constraints, requirements, and preferences relevant to this chat.
        - Any unresolved questions, TODOs, or next steps.

        Do NOT include:
        - Greetings or small talk.
        - Repeated questions or repeated explanations.
        - Intermediate brainstorming that was later discarded.
        - Details that are obvious from the final conclusions.

        Keep the summary factual and objective.
        Do not invent information or make assumptions.
        Write in third person.
        Prefer short paragraphs or bullet points.
        Maximum 300 words.

        Conversation:
        ${chatHistory}
    `
    : `Summarize this section of a larger conversation.
        Capture only information that should survive into the final conversation summary.
        
        Focus on:
        - Decisions made
        - Important facts
        - Technical designs
        - User goals
        - Open questions
        
        Avoid repeating information already stated within this section.
        
        Maximum 150 words.
        
        Conversation chunk:
        ${chatHistory}
    `

    const summary = await withGeneration(
        isFirst ? "summarize-chat" : "summarize-chat-chunk",
        {
            model: summaryModel,
            input: {
                isFirst,
                messageCount: messages.length,
                promptPreview: truncateForTrace(summaryPrompt, 800),
            },
            metadata: { feature: "chat-summary" },
        },
        async () => {
            const response = await openrouterClient.chat.send({
                chatRequest: {
                    model: summaryModel,
                    messages: [{ role: "user", content: summaryPrompt }],
                },
            });
            const content = response.choices[0]?.message.content ?? "";
            return {
                output: content,
                usage: (response as { usage?: OpenRouterUsageLike }).usage,
            };
        }
    );

    if(!isFirst){
        const mergePrompt = `The following are summaries of different sections of the same conversation.
            
            Merge them into one coherent summary.
            
            Requirements:
            - Remove duplicate information.
            - Preserve important chronology where useful.
            - Keep only durable information.
            - Include final decisions rather than intermediate alternatives.
            - Include unresolved tasks or follow-ups.
            - Do not invent new information.
            
            Return only the final summary.
            Maximum 300 words.
            
            previous summary:
            ${currentSummary}

            latest summary:
            ${summary}
        `

        return withGeneration(
            "merge-chat-summary",
            {
                model: summaryModel,
                input: {
                    previousSummary: truncateForTrace(currentSummary ?? "", 500),
                    latestSummary: truncateForTrace(summary, 500),
                },
                metadata: { feature: "chat-summary" },
            },
            async () => {
                const mergedSummary = await openrouterClient.chat.send({
                    chatRequest: {
                        model: summaryModel,
                        messages: [{ role: "user", content: mergePrompt }],
                    },
                });
                const content = mergedSummary.choices[0]?.message.content ?? "";
                return {
                    output: content,
                    usage: (mergedSummary as { usage?: OpenRouterUsageLike }).usage,
                };
            }
        );
    }

    return summary;
}

function isWebSearchCommand(message: string): boolean {
    return /^\/web(\s|$)/i.test(message.trimStart());
}

function stripWebPrefix(message: string): string {
    return message.replace(/^\/web\s*/i, "").trim();
}

function beginSse(res: import("express").Response) {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
}

function writeSse(res: Response, payload: Record<string, unknown>) {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

chatRouter.post("/message", async (req, res) => {
    const userId = req.userId;
    console.log(`[POST /message] Entry — userId=${userId}`);
    if (!userId) {
        console.warn(`[POST /message] Unauthorized — no userId`);
        res.status(401).json({ message: "Unauthorized" });
        return;
    }

    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) {
        console.warn(`[POST /message] Invalid input:`, parsed.error);
        res.status(422).json({ message: "Invalid input", error: parsed.error });
        return;
    }

    const { message, chatId, userAgent } = parsed.data;
    const webMode = isWebSearchCommand(message);
    const webQuery = webMode ? stripWebPrefix(message) : "";
    console.log(`[POST /message] Parsed: message="${message.slice(0, 120)}…", chatId=${chatId ?? "null (new session)"}, userAgent=${userAgent ? "yes" : "no"}, webMode=${webMode}`);

    if (webMode && !webQuery) {
        res.status(422).json({ message: "Add a query after /web, e.g. /web latest news on AI agents" });
        return;
    }

    try {
        // 1. Resolve or create chat session (session is created on first message)
        console.log(`[POST /message] Step 1 — Resolving chat session`);
        let chat =
            chatId != null
                ? await prismaClient.chat.findFirst({
                      where: { id: chatId, userId },
                      include: { project: { select: { id: true, name: true, systemPrompt: true } } },
                  })
                : null;

        if (chatId && !chat) {
            console.warn(`[POST /message] Requested chatId ${chatId} not found or not owned by user`);
            res.status(404).json({ message: "Chat not found" });
            return;
        }

        const isNewSession = !chat;
        const titleSeed = webMode ? webQuery : message;
        if (!chat) {
            console.log(`[POST /message] Creating new chat session for userId=${userId}`);
            chat = await prismaClient.chat.create({
                data: {
                    userId,
                    title: titleFromMessage(titleSeed),
                },
                include: { project: { select: { id: true, name: true, systemPrompt: true } } },
            });
        } else {
            console.log(`[POST /message] Using existing chat: id=${chat.id}, title="${chat.title}", pin=${chat.pinned}, projectId=${chat.projectId ?? "none"}`);
        }

        const projectSystemPrompt = chat.project?.systemPrompt ?? null;
        const resolvedChat = chat;

        // Root trace for the full turn — session groups multi-turn chats in Langfuse
        await startActiveObservation("chat-message", async (rootSpan) => {
            rootSpan.update({
                input: {
                    message: truncateForTrace(webMode ? webQuery : message, 1_000),
                    mode: webMode ? "web" : "memory",
                    isNewSession,
                },
                metadata: {
                    chatId: resolvedChat.id,
                    projectId: resolvedChat.projectId ?? null,
                },
            });

            await propagateAttributes(
                {
                    userId,
                    sessionId: resolvedChat.id,
                    tags: [
                        "chat",
                        webMode ? "web" : "memory",
                        isNewSession ? "new-session" : "continue-session",
                    ],
                    metadata: {
                        feature: webMode ? "web-agent" : "rag-chat",
                        projectId: resolvedChat.projectId ?? "",
                    },
                },
                async () => {
        // 2. Persist user message
        console.log(`[POST /message] Step 2 — Persisting user message in chat ${resolvedChat.id}`);
        const userMessage = await prismaClient.message.create({
            data: {
                chatId: resolvedChat.id,
                role: "user",
                content: message,
            },
        });
        console.log(`[POST /message] User message persisted: id=${userMessage.id}`);

        const shouldSetTitle = isNewSession || resolvedChat.title === "New chat";
        const title = shouldSetTitle ? titleFromMessage(titleSeed) : resolvedChat.title;

        // ── /web path: Exa + LangGraph agent (SSE, same shape as normal chat) ──
        if (webMode) {
            console.log(`[POST /message] Web-search agent path for query="${webQuery.slice(0, 120)}"`);
            beginSse(res);

            writeSse(res, {
                type: "meta",
                chatId: resolvedChat.id,
                title,
                isNewSession,
                mode: "web",
                userMessage: {
                    id: userMessage.id,
                    role: userMessage.role,
                    content: userMessage.content,
                    createdAt: userMessage.createdAt,
                },
                sources: [],
            });
            writeSse(res, {
                type: "status",
                message: "Starting web research agent…",
                mode: "web",
            });

            let clientClosed = false;
            req.on("close", () => {
                clientClosed = true;
                console.log(`[POST /message] Client disconnected during web agent for chat ${resolvedChat.id}`);
            });

            let assistantText = "";
            let sources: {
                rank: number;
                id: string;
                score: number;
                text: string;
                url?: string;
                title?: string;
            }[] = [];
            let streamFailed = false;
            let turnTokenUsage: TokenUsageSummary = emptyTokenUsage();

            try {
                const agentResult = await runWebSearchAgent(webQuery, {
                    userId,
                    sessionId: resolvedChat.id,
                    tags: ["chat"],
                    onEvent: async (event) => {
                    if (clientClosed || res.writableEnded) return;

                    const statusMessage =
                        event.step === "search"
                            ? event.detail ?? "Searching the web…"
                            : event.step === "reason"
                              ? event.title
                              : event.step === "answer"
                                ? "Writing answer from sources…"
                                : event.step === "done"
                                  ? "Web research complete"
                                  : event.title;

                    writeSse(res, {
                        type: "status",
                        message: statusMessage,
                        mode: "web",
                    });

                    writeSse(res, {
                        type: "agent_step",
                        step: event.step,
                        title: event.title,
                        detail: event.detail,
                        query: event.query,
                        resultCount: event.resultCount,
                        iteration: event.iteration,
                        enough: event.enough,
                        reasoning: event.reasoning,
                        nextQuery: event.nextQuery,
                    });
                    },
                });

                assistantText = agentResult.answer;
                turnTokenUsage = agentResult.tokenUsage;
                // Dedupe sources by URL for the panel
                const seen = new Set<string>();
                sources = agentResult.sources
                    .filter((s) => {
                        const key = s.url || s.title;
                        if (!key || seen.has(key)) return false;
                        seen.add(key);
                        return true;
                    })
                    .map((s, i) => ({
                        rank: i + 1,
                        id: s.url || `web-${i + 1}`,
                        score: 1,
                        text: s.text.slice(0, 350),
                        url: s.url || undefined,
                        title: s.title || undefined,
                    }));

                if (!clientClosed && !res.writableEnded) {
                    writeSse(res, {
                        type: "status",
                        message: "Streaming web answer…",
                        mode: "web",
                    });
                    // Agent returns full text; send as one delta for the existing client stream handler
                    writeSse(res, { type: "delta", content: assistantText });
                }
            } catch (webErr) {
                streamFailed = true;
                console.error(`[POST /message] Web agent error:`, webErr);
                if (!clientClosed && !res.writableEnded) {
                    writeSse(res, {
                        type: "error",
                        message:
                            webErr instanceof Error
                                ? webErr.message
                                : "Web search agent failed",
                    });
                }
            }

            if (!assistantText.trim()) {
                if (streamFailed) {
                    if (!res.writableEnded) res.end();
                    rootSpan.update({
                        level: "ERROR",
                        output: { error: "web-agent-failed" },
                    });
                    return;
                }
                assistantText = "I couldn't find enough information on the web to answer that.";
                if (!clientClosed && !res.writableEnded) {
                    writeSse(res, { type: "delta", content: assistantText });
                }
            }

            const assistantMessage = await prismaClient.message.create({
                data: {
                    chatId: resolvedChat.id,
                    role: "assistant",
                    content: assistantText,
                    sourceChunks: sources,
                },
            });

            await prismaClient.chat.update({
                where: { id: resolvedChat.id },
                data: {
                    updatedAt: new Date(),
                    ...(shouldSetTitle ? { title } : {}),
                },
            });

            if (!clientClosed && !res.writableEnded && !streamFailed) {
                writeSse(res, {
                    type: "done",
                    chatId: resolvedChat.id,
                    title,
                    isNewSession,
                    mode: "web",
                    userMessage: {
                        id: userMessage.id,
                        role: userMessage.role,
                        content: userMessage.content,
                        createdAt: userMessage.createdAt,
                    },
                    assistantMessage: {
                        id: assistantMessage.id,
                        role: assistantMessage.role,
                        content: assistantMessage.content,
                        createdAt: assistantMessage.createdAt,
                    },
                    sources,
                });
            }
            if (!res.writableEnded) res.end();
            const tokenFields = traceTokenUsageFields(turnTokenUsage);
            rootSpan.update({
                output: {
                    mode: "web",
                    answer: truncateForTrace(assistantText, 2_000),
                    sourceCount: sources.length,
                    ...tokenFields.output,
                },
                metadata: {
                    model: CHAT_MODEL,
                    ...tokenFields.metadata,
                },
                ...("usageDetails" in tokenFields
                    ? {
                          usageDetails: tokenFields.usageDetails,
                          costDetails: tokenFields.costDetails,
                      }
                    : {}),
            });
            console.log(`[POST /message] Web agent done for chat ${resolvedChat.id}`);
            return;
        }

        // 3. Hybrid retrieval (dense + sparse → RRF top 50)
        console.log(`[POST /message] Step 3 — Hybrid retrieval for: "${message.slice(0, 120)}"`);
        const fusedChunks = await hybridRetrieve(userId, message);
        console.log(`[POST /message] Hybrid retrieval returned ${fusedChunks.length} fused chunks`);

        // 4. Cross-encoder rerank → top 5
        console.log(`[POST /message] Step 4 — Cross-encoder rerank (top ${RERANK_TOP_K})`);
        const topChunks = await startActiveObservation(
            "cross-encode-rerank",
            async (span) => {
                span.update({
                    input: {
                        query: truncateForTrace(message, 300),
                        candidateCount: fusedChunks.length,
                        topK: RERANK_TOP_K,
                    },
                });
                const ranked = await crossEncodeRerank(
                    message,
                    fusedChunks.map((c) => ({ id: c.id, text: c.text, score: c.score })),
                    RERANK_TOP_K
                );
                span.update({
                    output: {
                        resultCount: ranked.length,
                        topScores: ranked.map((c) => ({ id: c.id, score: c.score })),
                    },
                });
                return ranked;
            }
        );
        console.log(`[POST /message] Rerank returned ${topChunks.length} chunks`);

        // 5. Load prior messages for multi-turn context
        console.log(`[POST /message] Step 5 — Loading history (last 20 messages)`);
        const history =
        (await prismaClient.message.findMany({
            where: { chatId: resolvedChat.id },
            orderBy: { createdAt: "desc" },
            take: 20,
        })).reverse();
        console.log(`[POST /message] History loaded: ${history.length} prior messages`);

        const llmMessages = [
            { role: "system" as const, content: await buildSystemPrompt(userId, resolvedChat.id, topChunks, projectSystemPrompt, userAgent) },
            ...history.map((m) => ({
                role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
                content: m.content,
            })),
        ];
        console.log(`[POST /message] LLM message array built: ${llmMessages.length} messages (1 system + ${history.length} history), projectPrompt=${Boolean(projectSystemPrompt)}, userAgent=${Boolean(userAgent)}`);

        // 6. Stream LLM reply via OpenRouter → SSE to the client
        const sources = topChunks.map((c, i) => ({
            rank: i + 1,
            id: c.id,
            score: c.score,
            text: c.text.slice(0, 400),
        }));

        beginSse(res);

        writeSse(res, {
            type: "meta",
            chatId: resolvedChat.id,
            title,
            isNewSession,
            mode: "memory",
            userMessage: {
                id: userMessage.id,
                role: userMessage.role,
                content: userMessage.content,
                createdAt: userMessage.createdAt,
            },
            sources,
        });

        let clientClosed = false;
        req.on("close", () => {
            clientClosed = true;
            console.log(`[POST /message] Client disconnected mid-stream for chat ${resolvedChat.id}`);
        });

        console.log(`[POST /message] Step 6 — Streaming OpenRouter model=${CHAT_MODEL}`);
        const startTime = Date.now();
        let assistantText = "";
        let turnTokenUsage: TokenUsageSummary = emptyTokenUsage();

        let streamFailed = false;
        try {
            const streamResult = await withStreamingGeneration(
                "generate-response",
                {
                    model: CHAT_MODEL,
                    input: {
                        message: truncateForTrace(message, 1_000),
                        historyTurns: history.length,
                        contextChunks: topChunks.length,
                    },
                    metadata: {
                        messageCount: llmMessages.length,
                        feature: "rag-chat",
                    },
                },
                async ({ noteCompletionStart }) => {
                    const llmStream = await openrouterClient.chat.send({
                        chatRequest: {
                            model: CHAT_MODEL,
                            messages: llmMessages,
                            stream: true,
                        },
                    });

                    let text = "";
                    let usage: OpenRouterUsageLike | null = null;
                    let firstToken = false;

                    for await (const chunk of llmStream) {
                        if (clientClosed) break;

                        if (chunk.error) {
                            throw new Error(chunk.error.message || "OpenRouter stream error");
                        }

                        if (chunk.usage) {
                            usage = chunk.usage as OpenRouterUsageLike;
                        }

                        const delta = chunk.choices?.[0]?.delta?.content;
                        if (typeof delta === "string" && delta.length > 0) {
                            if (!firstToken) {
                                firstToken = true;
                                noteCompletionStart();
                            }
                            text += delta;
                            writeSse(res, { type: "delta", content: delta });
                        }
                    }

                    return { output: text, usage };
                }
            );
            assistantText = streamResult.output;
            if (streamResult.usage) {
                turnTokenUsage = mergeTokenUsage(turnTokenUsage, streamResult.usage);
            }
        } catch (streamErr) {
            streamFailed = true;
            console.error(`[POST /message] OpenRouter stream error:`, streamErr);
            if (!clientClosed && !res.writableEnded) {
                writeSse(res, {
                    type: "error",
                    message:
                        streamErr instanceof Error
                            ? streamErr.message
                            : "Failed to stream model response",
                });
            }
        }

        const llmDuration = Date.now() - startTime;
        console.log(
            `[POST /message] OpenRouter stream finished in ${llmDuration}ms, ${assistantText.length} chars, clientClosed=${clientClosed}, streamFailed=${streamFailed}`
        );

        // Persist whatever we got (including partial) unless the model returned nothing
        if (!assistantText.trim()) {
            if (streamFailed) {
                if (!res.writableEnded) res.end();
                rootSpan.update({
                    level: "ERROR",
                    output: { error: "stream-failed" },
                });
                return;
            }
            assistantText = "I couldn't generate a response. Please try again.";
            if (!clientClosed && !res.writableEnded) {
                writeSse(res, { type: "delta", content: assistantText });
            }
        }

        console.log(`[POST /message] Persisting assistant message in chat ${resolvedChat.id}`);
        const assistantMessage = await prismaClient.message.create({
            data: {
                chatId: resolvedChat.id,
                role: "assistant",
                content: assistantText,
                sourceChunks: sources,
            },
        });
        console.log(`[POST /message] Assistant message persisted: id=${assistantMessage.id}`);

        console.log(`[POST /message] Bumping updatedAt (setTitle=${shouldSetTitle})`);
        const msgs = await prismaClient.chat.update({
            where: { id: resolvedChat.id },
            data: {
                updatedAt: new Date(),
                ...(shouldSetTitle ? { title } : {}),
            },
            select: { lastSummaryCount: true, summary: true },
        });

        if (!clientClosed && !res.writableEnded && !streamFailed) {
            writeSse(res, {
                type: "done",
                chatId: resolvedChat.id,
                title,
                isNewSession,
                mode: "memory",
                userMessage: {
                    id: userMessage.id,
                    role: userMessage.role,
                    content: userMessage.content,
                    createdAt: userMessage.createdAt,
                },
                assistantMessage: {
                    id: assistantMessage.id,
                    role: assistantMessage.role,
                    content: assistantMessage.content,
                    createdAt: assistantMessage.createdAt,
                },
                sources,
            });
        }
        if (!res.writableEnded) res.end();
        console.log(`[POST /message] Done — stream completed for chat ${resolvedChat.id}`);

        const tokenFields = traceTokenUsageFields(turnTokenUsage);
        rootSpan.update({
            output: {
                mode: "memory",
                answer: truncateForTrace(assistantText, 2_000),
                sourceCount: sources.length,
                durationMs: llmDuration,
                ...tokenFields.output,
            },
            metadata: {
                model: CHAT_MODEL,
                retrievedChunks: fusedChunks.length,
                rerankedChunks: topChunks.length,
                ...tokenFields.metadata,
            },
            ...("usageDetails" in tokenFields
                ? {
                      usageDetails: tokenFields.usageDetails,
                      costDetails: tokenFields.costDetails,
                  }
                : {}),
        });

        // Summarize in the background after the client has the full answer
        if (streamFailed) return;
        try {
            const messagesToSummarize = await prismaClient.message.findMany({
                where: { chatId: resolvedChat.id },
                orderBy: { createdAt: "asc" },
                skip: msgs.lastSummaryCount,
            });

            const N = 100;
            if (messagesToSummarize.length >= N) {
                const isFirst = msgs.lastSummaryCount === 0;
                const summary = await summarizeChat(msgs.summary, messagesToSummarize, isFirst);

                await prismaClient.chat.update({
                    where: { userId, id: resolvedChat.id },
                    data: {
                        summary,
                        lastSummaryCount: msgs.lastSummaryCount + messagesToSummarize.length,
                    },
                });
            }
        } catch (summaryErr) {
            console.error(`[POST /message] Summary update failed:`, summaryErr);
        }
                }
            );
        });
    } catch (e) {
        console.error(`[POST /message] Pipeline error:`, e);
        if (res.headersSent) {
            if (!res.writableEnded) {
                res.write(
                    `data: ${JSON.stringify({
                        type: "error",
                        message: e instanceof Error ? e.message : "Failed to process chat message",
                    })}\n\n`
                );
                res.end();
            }
            return;
        }
        res.status(500).json({
            message: "Failed to process chat message",
            error: e instanceof Error ? e.message : e,
        });
    }
});

export default chatRouter;