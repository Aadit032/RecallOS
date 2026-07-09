import { QdrantClient } from "@qdrant/js-client-rest";
import dotenv from "dotenv"
dotenv.config();

export const qdrantClient = new QdrantClient({ host: process.env.HOST as string, port: 6333 });

const COLLECTION = process.env.COLLECTION as string;
const DENSE_DIM = process.env.DENSE_DIM as string;

async function setup(){
    const exists = await qdrantClient.collectionExists(COLLECTION);
    if(exists.exists) return;

    await qdrantClient.createCollection(COLLECTION, {
      vectors: { size: Number(DENSE_DIM), distance: "Cosine" },
      sparse_vectors: { "bm25": { index: { on_disk: false } } }
    });
}

setup();