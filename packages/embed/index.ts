import { FlagEmbedding, EmbeddingModel } from "fastembed";
import { SparseTextEmbedding, SparseEmbeddingModel } from "fastembed";

// other options: BGESmallEN (384-dim, faster), BGELargeEN (1024-dim, better quality)
const denseModel = await FlagEmbedding.init({ model: EmbeddingModel.BGEBaseEN }); // 768-dim

const bm25 = await SparseTextEmbedding.init({ model: SparseEmbeddingModel.SpladePPEnV1 });

export async function getDenseVectors(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for await (const batch of denseModel.embed(texts, 32)) {
        vectors.push(...batch);
    }
    return vectors;
}

export async function getSparseVectors(texts: string[]) {
    const embeddings = [];
    for await (const batch of bm25.embed(texts, 32)) { // batchSize = 32
        embeddings.push(...batch); // each item: { indices: number[], values: number[] }
    }
    return embeddings;
}