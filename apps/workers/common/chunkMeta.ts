/**
 * Cheap, plan-agnostic document identity prefix for every chunk.
 * Prepended to chunk text so dense/sparse embeddings carry title + tags.
 */
export type ChunkDocMeta = {
    title: string;
    modality: string;
    tags?: string[] | null;
    /** Extra lines e.g. "Time: 12.0s–18.5s", "Scene: 3" */
    extraLines?: string[];
};

export function formatChunkHeader(meta: ChunkDocMeta): string {
    const lines: string[] = [
        `Document: ${meta.title.trim() || "untitled"}`,
        `Modality: ${meta.modality.trim() || "unknown"}`,
    ];

    const tags = (meta.tags ?? [])
        .map((t) => t.trim())
        .filter(Boolean);
    if (tags.length > 0) {
        lines.push(`Tags: ${tags.join(", ")}`);
    }

    for (const line of meta.extraLines ?? []) {
        const trimmed = line.trim();
        if (trimmed) lines.push(trimmed);
    }

    return lines.join("\n");
}

/** Header + body so retrieval models see document identity with content. */
export function withChunkHeader(body: string, meta: ChunkDocMeta): string {
    const header = formatChunkHeader(meta);
    const text = body.trim();
    if (!text) return header;
    return `${header}\n---\n${text}`;
}

/** Prisma-compatible JSON value (no free `unknown` keys). */
export type JsonObject = {
    [key: string]: string | number | boolean | null | string[] | number[] | JsonObject | JsonObject[];
};

/** Structured metadata stored on ParsedChunk + forwarded to Qdrant payload. */
export function chunkMetadataPayload(
    meta: ChunkDocMeta,
    extra: JsonObject = {}
): JsonObject {
    return {
        documentTitle: meta.title,
        tags: (meta.tags ?? []).map((t) => t.trim()).filter(Boolean),
        modality: meta.modality,
        ...extra,
    };
}
