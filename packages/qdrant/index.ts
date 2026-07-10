import { QdrantClient } from "@qdrant/js-client-rest";
import dotenv from "dotenv"
dotenv.config();

export const qdrantClient = new QdrantClient({ host: process.env.HOST as string, port: 6333 });

const COLLECTION = process.env.COLLECTION as string;
const DENSE_DIM = process.env.DENSE_DIM;

async function setup(){
    const exists = await qdrantClient.collectionExists(COLLECTION);
    if(exists.exists) {
      console.log("Qdrant collection already exists!!")
      return;
    }

    const created = await qdrantClient.createCollection(COLLECTION, {
      vectors: { dense: { size: Number(DENSE_DIM), distance: "Cosine" } },
      sparse_vectors: { splade: { index: { on_disk: false } } }
    });
    if(created) console.log("New collection created: ", COLLECTION);

}

setup();