import { FlagEmbedding, EmbeddingModel } from "fastembed";
import { SparseTextEmbedding, SparseEmbeddingModel } from "fastembed";
import { InferenceClient } from "@huggingface/inference";

// other options: BGESmallEN (384-dim, faster), BGELargeEN (1024-dim, better quality) BGEBaseEN 768-dim
const denseModel = await FlagEmbedding.init({ model: EmbeddingModel.BGESmallEN });

const splade = await SparseTextEmbedding.init({ model: SparseEmbeddingModel.SpladePPEnV1 });

/** Free HF Inference cross-encoder (optional token raises rate limits). */
const CROSS_ENCODER_MODEL =
    process.env.CROSS_ENCODER_MODEL as string ?? "cross-encoder/ms-marco-MiniLM-L6-v2";

const hf = new InferenceClient(process.env.HF_TOKEN ?? process.env.HUGGINGFACE_API_KEY);

export async function getDenseVectors(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for await (const batch of denseModel.embed(texts, 6)) {
        vectors.push(...batch);
    }
    return vectors;
}

export async function getSparseVectors(texts: string[]) {
    const embeddings = [];
    for await (const batch of splade.embed(texts, 6)) {
        // each item: { indices: number[], values: number[] }
        embeddings.push(...batch);
    }
    return embeddings;
}

export interface Chunk {
    id: number;
    text: string;
}

export interface RankableChunk {
    id: string;
    text: string;
    score?: number;
}

export interface RerankedChunk extends RankableChunk {
    score: number;
}

/**
 * Cross-encoder reranker: scores (query, chunk) pairs and returns the top-k chunks.
 * Uses Hugging Face Inference (free tier) with `cross-encoder/ms-marco-MiniLM-L6-v2`.
 * Falls back to the incoming retrieval scores if the remote model is unavailable.
 */
export async function crossEncodeRerank(
    query: string,
    chunks: RankableChunk[],
    topK = 5
): Promise<RerankedChunk[]> {
    if (chunks.length === 0) return [];

    const k = Math.min(topK, chunks.length);

    try {
        const scores = await scoreWithCrossEncoder(query, chunks.map((c) => c.text));
        const ranked = chunks
            .map((chunk, i) => ({
                ...chunk,
                score: scores[i] ?? chunk.score ?? 0,
            }))
            .sort((a, b) => b.score - a.score);

        return ranked.slice(0, k);
    } catch (err) {
        console.warn(
            "Cross-encoder failed; falling back to retrieval scores:",
            err instanceof Error ? err.message : err
        );
        return [...chunks]
            .map((c) => ({ ...c, score: c.score ?? 0 }))
            .sort((a, b) => b.score - a.score)
            .slice(0, k);
    }
}

/**
 * Score each passage against the query with a cross-encoder.
 * Batches requests to stay within HF free-tier payload limits.
 */
async function scoreWithCrossEncoder(query: string, passages: string[]): Promise<number[]> {
    const BATCH = 8;
    const scores: number[] = new Array(passages.length).fill(0);

    for (let start = 0; start < passages.length; start += BATCH) {
        const batch = passages.slice(start, start + BATCH);
        const batchScores = await Promise.all(
            batch.map(async (passage) => {
                // Cross-encoders expect a single sequence: query [SEP] passage
                const input = `${query} [SEP] ${passage.slice(0, 1500)}`;
                const result = await hf.textClassification({
                    model: CROSS_ENCODER_MODEL,
                    inputs: input,
                });

                // Prefer LABEL_1 / positive relevance score when present
                if (Array.isArray(result) && result.length > 0) {
                    const positive =
                        result.find(
                            (r) =>
                                /label_?1|relevant|positive/i.test(r.label) ||
                                r.label === "1"
                        ) ?? result[0];
                    return positive?.score ?? 0;
                }
                return 0;
            })
        );

        for (let i = 0; i < batchScores.length; i++) {
            scores[start + i] = batchScores[i] ?? 0;
        }
    }

    return scores;
}
