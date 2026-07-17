/**
 * Dev runner — spawns all modality workers concurrently.
 * Run individual workers with: bun run <worker>/index.ts
 */

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

for (const proc of processes) {
    await proc.exited;
}
