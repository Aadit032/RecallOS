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
});

export const bodySchema = z.object({
    title: z.string().min(1).max(200).optional(),
    pinned: z.boolean().optional(),
});