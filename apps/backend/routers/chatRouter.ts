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
    const [denseVectors, sparseVectors] = await Promise.all([
        getDenseVectors([query]),
        getSparseVectors([query]),
    ]);

    const denseVector = denseVectors[0];
    const sparse = sparseVectors[0];

    if (!denseVector || !sparse) {
        throw new Error("Failed to embed query");
    }

    const sparseQuery = {
        indices: Array.from(sparse.indices as Iterable<number>),
        values: Array.from(sparse.values as Iterable<number>),
    };

    const denseQuery = Array.from(denseVector as ArrayLike<number>);

    const res = await qdrantClient.query(COLLECTION, {
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
        // Reciprocal Rank Fusion over dense (cosine) + sparse (SPLADE) prefetches
        query: { fusion: "rrf" },
        limit: RETRIEVAL_LIMIT,
        with_payload: true,
    });

    return (res.points ?? []).map((point) => {
        const payload = (point.payload ?? {}) as Record<string, unknown>;
        return {
            id: String(point.id),
            text: typeof payload.text === "string" ? payload.text : "",
            score: point.score ?? 0,
            documentId: (payload.documentId as string | number | undefined) ?? null,
        };
    }).filter((c) => c.text.length > 0);
}

function buildSystemPrompt(contextChunks: { text: string; id: string }[]): string {
    const context = contextChunks
        .map((c, i) => `[${i + 1}] (id: ${c.id})\n${c.text}`)
        .join("\n\n---\n\n");

    return `You are RecallOS, an assistant that answers questions using the user's organizational knowledge base.
        Use ONLY the context chunks below to answer. If the context is insufficient, say so clearly.
        Cite chunk numbers like [1], [2] when you rely on them.
        Be concise and accurate.

        Context chunks:
        ${context || "(No relevant chunks found.)"}`;
}

function titleFromMessage(message: string): string {
    const trimmed = message.trim().replace(/\s+/g, " ");
    return trimmed.length <= 48 ? trimmed : `${trimmed.slice(0, 48)}…`;
}


chatRouter.get("/", async (req, res) => {
    const userId = req.userId;

    try {
        const chats = await prismaClient.chat.findMany({
            where: { userId },
            orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
            include: {
                messages: {
                    orderBy: { createdAt: "desc" },
                    select: { id: true, role: true, content: true, createdAt: true },
                    take: 20
                },
            },
        });

        res.status(200).json({ chats });
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

    try {
        const chat = await prismaClient.chat.findFirst({
            where: { id, userId },
            include: {
                messages: {
                    orderBy: { createdAt: "asc" },
                    select: { id: true, role: true, content: true, createdAt: true },
                },
            },
        });

        if (!chat) {
            res.status(404).json({ message: "Chat not found" });
            return;
        }

        res.status(200).json({ chat });
    } catch (e) {
        console.error("Get chat error:", e);
        res.status(500).json({
            message: "Failed to get chat",
            error: e instanceof Error ? e.message : e,
        });
    }
});


chatRouter.patch("/:id", async (req, res) => {
    const userId = req.userId;
    const id = req.params.id;
    if (!userId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(422).json({ message: "Invalid input", error: parsed.error });
        return;
    }

    try {
        const existing = await prismaClient.chat.findFirst({ where: { id, userId } });
        if (!existing) {
            res.status(404).json({ message: "Chat not found" });
            return;
        }

        const chat = await prismaClient.chat.update({
            where: { id },
            data: parsed.data,
        });

        res.status(200).json({ chat });
    } catch (e) {
        console.error("Patch chat error:", e);
        res.status(500).json({
            message: "Failed to update chat",
            error: e instanceof Error ? e.message : e,
        });
    }
});


chatRouter.delete("/:id", async (req, res) => {
    const userId = req.userId;
    const id = req.params.id;
    if (!userId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }

    try {
        const existing = await prismaClient.chat.findFirst({ where: { id, userId } });
        if (!existing) {
            res.status(404).json({ message: "Chat not found" });
            return;
        }

        await prismaClient.chat.delete({ where: { id } });
        res.status(200).json({ message: "Chat deleted" });
    } catch (e) {
        console.error("Delete chat error:", e);
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
    if (!userId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }

    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(422).json({ message: "Invalid input", error: parsed.error });
        return;
    }

    const { message, chatId } = parsed.data;

    try {
        // 1. Resolve or create chat session (session is created on first message)
        let chat =
            chatId != null
                ? await prismaClient.chat.findFirst({ where: { id: chatId, userId } })
                : null;

        if (chatId && !chat) {
            res.status(404).json({ message: "Chat not found" });
            return;
        }

        const isNewSession = !chat;
        if (!chat) {
            chat = await prismaClient.chat.create({
                data: {
                    userId,
                    title: titleFromMessage(message),
                },
            });
        }

        // 2. Persist user message
        const userMessage = await prismaClient.message.create({
            data: {
                chatId: chat.id,
                role: "user",
                content: message,
            },
        });

        // 3. Hybrid retrieval (dense + sparse → RRF top 50)
        const fusedChunks = await hybridRetrieve(message);

        // 4. Cross-encoder rerank → top 5
        const topChunks = await crossEncodeRerank(
            message,
            fusedChunks.map((c) => ({ id: c.id, text: c.text, score: c.score })),
            RERANK_TOP_K
        );

        // 5. Load prior messages for multi-turn context
        const history = await prismaClient.message.findMany({
            where: { chatId: chat.id },
            orderBy: { createdAt: "asc" },
            take: 20,
        });

        const llmMessages = [
            { role: "system" as const, content: buildSystemPrompt(topChunks) },
            ...history.map((m) => ({
                role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
                content: m.content,
            })),
        ];

        // 6. LLM call via OpenRouter
        const llmResponse = await openrouterClient.chat.send({
            chatRequest: {
                model: CHAT_MODEL,
                messages: llmMessages,
            },
        });

        const assistantText =
            (typeof llmResponse?.choices?.[0]?.message?.content === "string"
                ? llmResponse.choices[0].message.content
                : null) ??
            "I couldn't generate a response. Please try again.";

        const assistantMessage = await prismaClient.message.create({
            data: {
                chatId: chat.id,
                role: "assistant",
                content: assistantText,
            },
        });

        // Bump updatedAt; set title on first message of an existing empty-titled chat
        await prismaClient.chat.update({
            where: { id: chat.id },
            data: {
                updatedAt: new Date(),
                ...(isNewSession || chat.title === "New chat"
                    ? { title: titleFromMessage(message) }
                    : {}),
            },
        });

        res.status(200).json({
            chatId: chat.id,
            title: isNewSession || chat.title === "New chat" ? titleFromMessage(message) : chat.title,
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
    } catch (e) {
        console.error("Chat message error:", e);
        res.status(500).json({
            message: "Failed to process chat message",
            error: e instanceof Error ? e.message : e,
        });
    }
});

export default chatRouter;
