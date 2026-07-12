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

// logs:

// [qdrant] Initializing client — host="localhost", port=6333
// [qdrant] Client created
// DENSE_DIM: 384
// [qdrant:setup] Checking if collection "recallos" exists
// Checking the qdrant schema...
// [minio:ensureBucketExists] Bucket "recallos" already exists.
// schema:  {
// status: "green",
// optimizer_status: "ok",
// indexed_vectors_count: 0,
// points_count: 0,
// segments_count: 4,
// config: {
// params: {
// vectors: [Object ...],
// shard_number: 1,
// replication_factor: 1,
// write_consistency_factor: 1,
// on_disk_payload: true,
// sparse_vectors: [Object ...],
// },
// hnsw_config: {
// m: 16,
// ef_construct: 100,
// full_scan_threshold: 10000,
// max_indexing_threads: 0,
// on_disk: false,
// },
// optimizer_config: {
// deleted_threshold: 0.2,
// vacuum_min_vector_number: 1000,
// default_segment_number: 0,
// max_segment_size: null,
// memmap_threshold: null,
// indexing_threshold: 10000,
// flush_interval_sec: 5,
// max_optimization_threads: null,
// prevent_unoptimized: null,
// },
// wal_config: {
// wal_capacity_mb: 32,
// wal_segments_ahead: 0,
// wal_retain_closed: 1,
// },
// quantization_config: null,
// },
// payload_schema: {},
// update_queue: {
// length: 0,
// },
// }
