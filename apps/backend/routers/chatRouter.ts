import { Router } from "express";
import { z } from "zod";
import { qdrantClient } from "@repo/qdrant/client";
import { prismaClient } from "@repo/prisma/client";
import { getDenseVectors, getSparseVectors, crossEncodeRerank } from "@repo/embed/client";
import { openrouterClient } from "@repo/openrouter/client";
import { messageSchema, bodySchema } from "../types"
import dotenv from "dotenv";

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
 */
async function hybridRetrieve(query: string): Promise<RetrievedChunk[]> {
    console.log(`[hybridRetrieve] Starting retrieval for query: "${query.slice(0, 120)}"`);
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

    console.log(`[hybridRetrieve] Querying Qdrant collection "${COLLECTION}" with dense (${denseQuery.length}d) + sparse (${sparseQuery.indices.length} nnz) RRF, limit=${RETRIEVAL_LIMIT}`);
    let res;
    try {
        res = await qdrantClient.query(COLLECTION, {
            prefetch: [
                {
                    query: denseQuery,
                    using: "dense",
                    limit: RETRIEVAL_LIMIT,
                },
                {
                    query: sparseQuery,
                    using: "splade",
                    limit: RETRIEVAL_LIMIT,
                },
            ],
            query: { fusion: "rrf" },
            limit: RETRIEVAL_LIMIT,
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

    const chunks = (res.points ?? []).map((point) => {
        const payload = (point.payload ?? {}) as Record<string, unknown>;
        return {
            id: String(point.id),
            text: typeof payload.text === "string" ? payload.text : "",
            score: point.score ?? 0,
            documentId: (payload.documentId as string | number | undefined) ?? null,
        };
    }).filter((c) => c.text.length > 0);

    console.log(`[hybridRetrieve] Qdrant returned ${res.points?.length ?? 0} RRF points, ${chunks.length} chunks with text`);
    return chunks;
}

async function buildSystemPrompt(
    userId: string,
    contextChunks: { text: string; id: string }[],
    projectSystemPrompt?: string | null
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

    const responses = await prismaClient.chat.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: { summary: true }
    });

    let finalSummary = responses.map(r => r.summary)
    .filter((s): s is string => s !== null)
    .join("\n");

    console.log(`[buildSystemPrompt] finalSummary: ${finalSummary}`);

    return `You are RecallOS, an assistant that answers questions using the user's organizational knowledge base.
        Use ONLY the context chunks below to answer. If the context is insufficient, say so clearly.
        Cite chunk numbers like [1], [2] when you rely on them.
        Be concise and accurate.
        
        Recent conversation summaries: 
        ${finalSummary || "None"} 
        
        ${projectBlock}

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

    const { message, chatId } = parsed.data;
    console.log(`[POST /message] Parsed: message="${message.slice(0, 120)}…", chatId=${chatId ?? "null (new session)"}`);

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
        if (!chat) {
            console.log(`[POST /message] Creating new chat session for userId=${userId}`);
            chat = await prismaClient.chat.create({
                data: {
                    userId,
                    title: titleFromMessage(message),
                },
                include: { project: { select: { id: true, name: true, systemPrompt: true } } },
            });
        } else {
            console.log(`[POST /message] Using existing chat: id=${chat.id}, title="${chat.title}", pin=${chat.pinned}, projectId=${chat.projectId ?? "none"}`);
        }

        const projectSystemPrompt = chat.project?.systemPrompt ?? null;

        // 2. Persist user message
        console.log(`[POST /message] Step 2 — Persisting user message in chat ${chat.id}`);
        const userMessage = await prismaClient.message.create({
            data: {
                chatId: chat.id,
                role: "user",
                content: message,
            },
        });
        console.log(`[POST /message] User message persisted: id=${userMessage.id}`);

        // 3. Hybrid retrieval (dense + sparse → RRF top 50)
        console.log(`[POST /message] Step 3 — Hybrid retrieval for: "${message.slice(0, 120)}"`);
        const fusedChunks = await hybridRetrieve(message);
        console.log(`[POST /message] Hybrid retrieval returned ${fusedChunks.length} fused chunks`);

        // 4. Cross-encoder rerank → top 5
        console.log(`[POST /message] Step 4 — Cross-encoder rerank (top ${RERANK_TOP_K})`);
        const topChunks = await crossEncodeRerank(
            message,
            fusedChunks.map((c) => ({ id: c.id, text: c.text, score: c.score })),
            RERANK_TOP_K
        );
        console.log(`[POST /message] Rerank returned ${topChunks.length} chunks`);

        // 5. Load prior messages for multi-turn context
        console.log(`[POST /message] Step 5 — Loading history (last 20 messages)`);
        
        const history = 
        (await prismaClient.message.findMany({
            where: { chatId: chat.id },
            orderBy: { createdAt: "desc" },
            take: 20,
        })).reverse();

        console.log(`[POST /message] History loaded: ${history.length} prior messages`);

        const llmMessages = [
            { role: "system" as const, content: await buildSystemPrompt(userId, topChunks, projectSystemPrompt) },
            ...history.map((m) => ({
                role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
                content: m.content,
            })),
        ];
        console.log(`[POST /message] LLM message array built: ${llmMessages.length} messages (1 system + ${history.length} history), projectPrompt=${Boolean(projectSystemPrompt)}`);

        // 6. LLM call via OpenRouter
        console.log(`[POST /message] Step 6 — Calling OpenRouter model=${CHAT_MODEL}`);
        const startTime = Date.now();
        const llmResponse = await openrouterClient.chat.send({
            chatRequest: {
                model: CHAT_MODEL,
                messages: llmMessages,
            },
        });
        const llmDuration = Date.now() - startTime;
        console.log(`[POST /message] OpenRouter response received in ${llmDuration}ms`);

        const assistantText =
            (typeof llmResponse?.choices?.[0]?.message?.content === "string"
                ? llmResponse.choices[0].message.content
                : null) ??
            "I couldn't generate a response. Please try again.";

        console.log(`[POST /message] Assistant text length: ${assistantText.length} chars, finish_reason: ${JSON.stringify(llmResponse?.choices?.[0]?.finishReason ?? "unknown")}`);

        console.log(`[POST /message] Persisting assistant message in chat ${chat.id}`);
        const assistantMessage = await prismaClient.message.create({
            data: {
                chatId: chat.id,
                role: "assistant",
                content: assistantText,
                sourceChunks: topChunks.map((c, i) => ({
                    rank: i + 1,
                    id: c.id,
                    score: c.score,
                    text: c.text.slice(0, 400),
                })),
            },
        });
        console.log(`[POST /message] Assistant message persisted: id=${assistantMessage.id}`);

        // Bump updatedAt; set title on first message of an existing empty-titled chat
        const shouldSetTitle = isNewSession || chat.title === "New chat";
        console.log(`[POST /message] Bumping updatedAt (setTitle=${shouldSetTitle})`);
        await prismaClient.chat.update({
            where: { id: chat.id },
            data: {
                updatedAt: new Date(),
                ...(shouldSetTitle
                    ? { title: titleFromMessage(message) }
                    : {}),
            },
        });

        console.log(`[POST /message] Sending 200 response — chatId=${chat.id}, isNewSession=${isNewSession}, sources=${topChunks.length}`);
        res.status(200).json({
            chatId: chat.id,
            title: shouldSetTitle ? titleFromMessage(message) : chat.title,
            isNewSession,
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
            sources: topChunks.map((c, i) => ({
                rank: i + 1,
                id: c.id,
                score: c.score,
                text: c.text.slice(0, 400),
            })),
        });
        console.log(`[POST /message] Done — total pipeline completed`);
    } catch (e) {
        console.error(`[POST /message] Pipeline error:`, e);
        res.status(500).json({
            message: "Failed to process chat message",
            error: e instanceof Error ? e.message : e,
        });
    }
});

export default chatRouter;