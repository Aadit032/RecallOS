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