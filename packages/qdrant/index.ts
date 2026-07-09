import { QdrantClient } from "@qdrant/js-client-rest";
import dotenv from "dotenv"
dotenv.config();

export const qdrantClient = new QdrantClient({ host: process.env.HOST as string, port: 6333 });

qdrantClient.createCollection("{collection_name}", {
  vectors: { size: 100, distance: "Cosine" },
  sparse_vectors: {
    "splade-model-name": { index: { on_disk: false } }
  }
});