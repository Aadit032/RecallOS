import type { RetrievedChunk } from "./hybridRetrieve.ts";

const SNIPPET_MAX = 320;
const PREVIEW_MAX = 900;

/** Strip the cheap metadata header so the UI shows content, not "Document: …". */
export function snippetFromChunk(text: string, max = SNIPPET_MAX): string {
    let body = text;
    const sep = "\n---\n";
    const idx = text.indexOf(sep);
    if (idx !== -1 && text.startsWith("Document:")) {
        body = text.slice(idx + sep.length);
    }
    const collapsed = body.replace(/\s+/g, " ").trim();
    if (collapsed.length <= max) return collapsed;
    return `${collapsed.slice(0, max)}…`;
}

/**
 * Map raw RRF/hybrid scores onto a stable 0–100 confidence scale relative to
 * the top hit on this result page (so the best match reads ~high confidence).
 */
export function confidenceFromScores(score: number, maxScore: number): number {
    if (!Number.isFinite(score) || score <= 0) return 0;
    if (!Number.isFinite(maxScore) || maxScore <= 0) {
        return Math.max(1, Math.min(99, Math.round(score * 100)));
    }
    const ratio = score / maxScore;
    // Soft curve so mid-rank hits don't all look identical
    const curved = Math.pow(Math.max(0, Math.min(1, ratio)), 0.85);
    return Math.max(1, Math.min(99, Math.round(curved * 100)));
}

export type AggregatedDoc = {
    documentId: string;
    score: number;
    snippet: string | null;
    preview: string | null;
    chunkId: string | null;
    bestChunk: RetrievedChunk;
};

/**
 * Group hybrid chunks by documentId, keep max score + best snippet/preview.
 */
export function aggregateByDocument(chunks: RetrievedChunk[]): AggregatedDoc[] {
    const map = new Map<string, AggregatedDoc>();

    for (const chunk of chunks) {
        const documentId = chunk.documentId == null ? null : String(chunk.documentId);
        if (!documentId) continue;

        const existing = map.get(documentId);
        if (!existing || chunk.score > existing.score) {
            map.set(documentId, {
                documentId,
                score: chunk.score,
                snippet: snippetFromChunk(chunk.text, SNIPPET_MAX) || null,
                preview: snippetFromChunk(chunk.text, PREVIEW_MAX) || null,
                chunkId: chunk.id ?? null,
                bestChunk: chunk,
            });
        }
    }

    return Array.from(map.values()).sort((a, b) => b.score - a.score);
}
