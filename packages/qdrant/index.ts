import { QdrantClient } from "@qdrant/js-client-rest";
import dotenv from "dotenv"
dotenv.config();

const HOST = process.env.HOST as string;
console.log(`[qdrant] Initializing client — host="${HOST}", port=6333`);
export const qdrantClient = new QdrantClient({ host: HOST, port: 6333 });
console.log(`[qdrant] Client created`);

const COLLECTION = process.env.COLLECTION as string;
const DENSE_DIM = process.env.DENSE_DIM;

console.log(`DENSE_DIM: ${Number(DENSE_DIM)}`)

async function setup(){
    console.log(`[qdrant:setup] Checking if collection "${COLLECTION}" exists`);
    const exists = await qdrantClient.collectionExists(COLLECTION);
    if(exists.exists) {
      console.log(`[qdrant:setup] Collection "${COLLECTION}" already exists`);
      return;
    }

    console.log(`[qdrant:setup] Creating collection "${COLLECTION}" with dense dim=${DENSE_DIM}`);
    const created = await qdrantClient.createCollection(COLLECTION, {
      vectors: { dense: { size: Number(DENSE_DIM), distance: "Cosine" } },
      sparse_vectors: { splade: { index: { on_disk: false } } }
    });
    console.log(`[qdrant:setup] Collection "${COLLECTION}" created:`, created);
}

setup();

console.log(`Checking the qdrant schema...`);
const info = await qdrantClient.getCollection(COLLECTION);
console.log("schema: ", info);