import { FlagEmbedding, EmbeddingModel } from "fastembed";
import { SparseTextEmbedding, SparseEmbeddingModel } from "fastembed";
import { InferenceClient } from "@huggingface/inference";

let _denseModel: FlagEmbedding | null = null;
let _splade: SparseTextEmbedding | null = null;

async function getDenseModel(): Promise<FlagEmbedding> {
    if (!_denseModel) {
        console.log("[embed] Initializing BGE-small-en dense model...");
        _denseModel = await FlagEmbedding.init({ model: EmbeddingModel.BGESmallEN });
    }
    return _denseModel;
}

async function getSplade(): Promise<SparseTextEmbedding> {
    if (!_splade) {
        console.log("[embed] Initializing SPLADE sparse model...");
        _splade = await SparseTextEmbedding.init({ model: SparseEmbeddingModel.SpladePPEnV1 });
    }
    return _splade;
}

/** Free HF Inference cross-encoder (optional token raises rate limits). */
const CROSS_ENCODER_MODEL =
    process.env.CROSS_ENCODER_MODEL as string ?? "cross-encoder/ms-marco-MiniLM-L6-v2";

const hf = new InferenceClient(process.env.HF_TOKEN ?? process.env.HUGGINGFACE_API_KEY);

export async function getDenseVectors(texts: string[]): Promise<number[][]> {
    console.log(`[embed:getDenseVectors] Embedding ${texts.length} text(s) — first text: "${texts[0]?.slice(0, 80) ?? "none"}"`);
    const model = await getDenseModel();
    const vectors: number[][] = [];
    let batchCount = 0;
    for await (const batch of model.embed(texts, 6)) {
        vectors.push(...batch);
        batchCount++;
    }
    console.log(`[embed:getDenseVectors] Produced ${vectors.length} dense vectors (${batchCount} batch(es)), dim=${vectors[0]?.length ?? 0}`);
    return vectors;
}

export async function getSparseVectors(texts: string[]) {
    console.log(`[embed:getSparseVectors] Embedding ${texts.length} text(s) with SPLADE`);
    const model = await getSplade();
    const embeddings = [];
    let batchCount = 0;
    for await (const batch of model.embed(texts, 6)) {
        // each item: { indices: number[], values: number[] }
        embeddings.push(...batch);
        batchCount++;
    }
    console.log(`[embed:getSparseVectors] Produced ${embeddings.length} sparse vectors (${batchCount} batch(es)), nnz=${embeddings[0]?.indices?.length ?? 0}`);
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
    console.log(`[embed:crossEncodeRerank] Entry — query="${query.slice(0, 80)}", ${chunks.length} chunks, topK=${topK}`);
    if (chunks.length === 0) {
        console.log(`[embed:crossEncodeRerank] No chunks to rerank, returning empty`);
        return [];
    }

    const k = Math.min(topK, chunks.length);

    try {
        console.log(`[embed:crossEncodeRerank] Calling scoreWithCrossEncoder`);
        const scores = await scoreWithCrossEncoder(query, chunks.map((c) => c.text));
        console.log(`[embed:crossEncodeRerank] Got ${scores.length} scores`);

        const ranked = chunks
            .map((chunk, i) => ({
                ...chunk,
                score: scores[i] ?? chunk.score ?? 0,
            }))
            .sort((a, b) => b.score - a.score);

        const result = ranked.slice(0, k);
        console.log(`[embed:crossEncodeRerank] Top score: ${result[0]?.score?.toFixed(4) ?? "N/A"}, bottom score: ${result[result.length - 1]?.score?.toFixed(4) ?? "N/A"}`);
        return result;
    } catch (err) {
        console.warn(
            "[embed:crossEncodeRerank] Cross-encoder failed; falling back to retrieval scores:",
            err instanceof Error ? err.message : err
        );
        const fallback = [...chunks]
            .map((c) => ({ ...c, score: c.score ?? 0 }))
            .sort((a, b) => b.score - a.score)
            .slice(0, k);
        console.log(`[embed:crossEncodeRerank] Fallback top score: ${fallback[0]?.score?.toFixed(4) ?? "N/A"}`);
        return fallback;
    }
}

/**
 * Score each passage against the query with a cross-encoder.
 * Batches requests to stay within HF free-tier payload limits.
 */
async function scoreWithCrossEncoder(query: string, passages: string[]): Promise<number[]> {
    const BATCH = 8;
    const scores: number[] = new Array(passages.length).fill(0);
    console.log(`[embed:scoreWithCrossEncoder] Scoring ${passages.length} passages in batches of ${BATCH} using ${CROSS_ENCODER_MODEL}`);

    for (let start = 0; start < passages.length; start += BATCH) {
        const batch = passages.slice(start, start + BATCH);
        console.log(`[embed:scoreWithCrossEncoder] Batch ${start / BATCH + 1}/${Math.ceil(passages.length / BATCH)} (indices ${start}-${start + batch.length - 1})`);
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
        console.log(`[embed:scoreWithCrossEncoder] Batch done — scores: [${batchScores.map(s => s.toFixed(3)).join(", ")}]`);
    }

    console.log(`[embed:scoreWithCrossEncoder] All ${scores.length} scores computed`);
    return scores;
}
