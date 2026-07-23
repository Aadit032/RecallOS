import { OpenRouter } from "@openrouter/sdk";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set");

export const openrouterClient = new OpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });