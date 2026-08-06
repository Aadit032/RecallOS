/** Map MIME type to S3 key prefix (folder). Prefer buildUploadObjectKey for new uploads. */
export function keyPrefix(mimeType: string): string {
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("audio/")) return "audio";
    if (mimeType.startsWith("video/")) return "video";
    return "pdf";
}

export function modalityFromMime(mimeType: string): string {
    const m = mimeType.trim().toLowerCase().split(";")[0]!.trim();
    if (m.startsWith("image/")) return "image";
    if (m.startsWith("audio/")) return "audio";
    if (m.startsWith("video/")) return "video";
    return "pdf";
}

/** Normalize free-form upload tags: trim, drop empty, dedupe case-insensitively. */
export function normalizeTags(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const maxTags = 20;
    const maxLen = 40;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of raw) {
        if (typeof item !== "string") continue;
        const tag = item.trim().slice(0, maxLen);
        if (!tag) continue;
        const key = tag.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(tag);
        if (out.length >= maxTags) break;
    }
    return out;
}
