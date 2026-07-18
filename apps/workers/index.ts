/**
 * Dev runner — spawns all modality workers concurrently.
 * Run individual workers with: bun run <worker>/index.ts
 */
import LlamaCloud from '@llamaindex/llama-cloud';

export const llamaClient = new LlamaCloud({ apiKey: process.env['LLAMA_CLOUD_API_KEY'] });

export type Tier = "fast" | "cost_effective" | "agentic" | "agentic_plus";

const workers = [
    "dispatcher",
    "pdf",
    "image",
    "audio",
    "video",
    "scene",
    "embedder",
    "dlq",
] as const;

console.log(`[workers:runner] Starting ${workers.length} workers: ${workers.join(", ")}`);

const processes = workers.map((name) =>
    Bun.spawn(["bun", `${name}/index.ts`], {
        cwd: import.meta.dir,
        stdio: ["inherit", "inherit", "inherit"],
    })
);

for (const proc of processes) await proc.exited;
