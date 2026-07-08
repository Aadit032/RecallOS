import { z } from "zod"

export const signupSchema = z.object({
    username: z.string().min(3).max(20),
    password: z.string().min(3).max(20)
})

export const signinSchema = z.object({
    username: z.string().min(3).max(20),
    password: z.string().min(3).max(20)
})