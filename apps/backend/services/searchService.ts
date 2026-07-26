import type { RetrievedChunk } from "./hybridRetrieve.ts";

const SNIPPET_MAX = 320;

/** Strip the cheap metadata header so the UI shows content, not "Document: …". */
export function snippetFromChunk(text: string): string {
    let body = text;
    const sep = "\n---\n";
    const idx = text.indexOf(sep);
    if (idx !== -1 && text.startsWith("Document:")) {
        body = text.slice(idx + sep.length);
    }
    const collapsed = body.replace(/\s+/g, " ").trim();
    if (collapsed.length <= SNIPPET_MAX) return collapsed;
    return `${collapsed.slice(0, SNIPPET_MAX)}…`;
}

export type AggregatedDoc = {
    documentId: string;
    score: number;
    snippet: string | null;
    bestChunk: RetrievedChunk;
};

/**
 * Group hybrid chunks by documentId, keep max score + best snippet.
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
                snippet: snippetFromChunk(chunk.text) || null,
                bestChunk: chunk,
            });
        }
    }

    return Array.from(map.values()).sort((a, b) => b.score - a.score);
}
