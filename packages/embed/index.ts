import { FlagEmbedding, EmbeddingModel } from "fastembed";
import { SparseTextEmbedding, SparseEmbeddingModel } from "fastembed";

// other options: BGESmallEN (384-dim, faster), BGELargeEN (1024-dim, better quality) BGEBaseEN 768-dim
const denseModel = await FlagEmbedding.init({ model: EmbeddingModel.BGESmallEN });

const splade = await SparseTextEmbedding.init({ model: SparseEmbeddingModel.SpladePPEnV1 });

export async function getDenseVectors(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for await (const batch of denseModel.embed(texts, 6)) {
        vectors.push(...batch);
    }
    return vectors;
}

export async function getSparseVectors(texts: string[]) {
    const embeddings = [];
    for await (const batch of splade.embed(texts, 6)) { // batchSize = 32
        embeddings.push(...batch); // each item: { indices: number[], values: number[] }
    }
    return embeddings;
}