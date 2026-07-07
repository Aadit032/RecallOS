// import express from 'express';
import cors from "cors";
import uploadRouter from "./routers/uploadRouter.ts"
import Router from "express"
import LlamaCloud from '@llamaindex/llama-cloud'; 
import { redisClient } from "@repo/redis-stream/client"
import dotenv from "dotenv"
dotenv.config()

const PORT = process.env.PORT

export const client = new LlamaCloud({
  apiKey: process.env['LLAMA_CLOUD_API_KEY'],
});

const router = Router();
router.use(cors());

router.use("/api/v1/upload", uploadRouter)


router.listen(PORT, () => {
    `Server is listening on ${PORT}`
});