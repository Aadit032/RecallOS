import { z } from "zod"

export const signupSchema = z.object({
    username: z.string().min(3).max(20),
    password: z.string().min(3).max(20)
})

export const signinSchema = z.object({
    username: z.string().min(3).max(20),
    password: z.string().min(3).max(20)
})

export const messageSchema = z.object({
    message: z.string().min(1).max(8000),
    chatId: z.string().uuid().optional(),
    /** Browser user-agent — injected into the system prompt, not stored as user text */
    userAgent: z.string().max(1000).optional(),
    /** Optional modality filter: "pdf" | "image" | "audio" | "video" */
    modality: z.string().optional(),
    /** Force multi-hop agent (also triggered by `/agent` prefix) */
    agentMode: z.boolean().optional(),
});

export const createMemorySchema = z.object({
    fact: z.string().trim().min(3).max(500),
    importance: z.number().int().min(1).max(10).optional(),
});

export const createConnectorSchema = z.object({
    type: z.enum(["github", "rss", "url", "notion"]),
    name: z.string().trim().min(1).max(120),
    config: z.record(z.string(), z.unknown()).default({}),
    syncInterval: z.number().int().min(5).max(24 * 60).optional(),
});

export const updateConnectorSchema = z.object({
    status: z.enum(["ACTIVE", "PAUSED"]).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    syncInterval: z.number().int().min(5).max(24 * 60).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
});

export const bodySchema = z.object({
    title: z.string().min(1).max(200).optional(),
    pinned: z.boolean().optional(),
    projectId: z.string().uuid().nullable().optional(),
});

export const createProjectSchema = z.object({
    name: z.string().min(1).max(100),
    systemPrompt: z.string().max(8000).optional().nullable(),
});

export const updateProjectSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    systemPrompt: z.string().max(8000).optional().nullable(),
});

export const ReasoningSchema = z.object({
    enoughInformation: z.boolean(),
    nextSearchQuery: z.string().default(""),
    reasoning: z.string(),
});

export const searchSchema = z.object({
    query: z.string().trim().min(1).max(2000),
    limit: z.number().int().min(1).max(50).optional(),
    offset: z.number().int().min(0).optional(),
    modality: z.string().trim().min(1).max(32).optional(),
});