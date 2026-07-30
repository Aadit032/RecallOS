import { prismaClient } from "@repo/prisma/client";
import type { RetrievedChunk } from "./hybridRetrieve.ts";
import type { GroundedSource } from "../agents/memoryAgent.ts";

/**
 * Enrich retrieved chunks with document ObjectKey + title for multimodal
 * citation UI (open PDF page, seek audio/video, show image).
 */
export async function enrichSourcesWithDocuments(
    userId: string,
    chunks: Array<{
        id: string;
        score: number;
        text: string;
        documentId?: string | number | null;
        documentTitle?: string | null;
        modality?: string | null;
        page?: number | null;
        timestampStart?: number | null;
        timestampEnd?: number | null;
        caption?: string | null;
    }>
): Promise<GroundedSource[]> {
    const docIds = [
        ...new Set(
            chunks
                .map((c) => (c.documentId != null ? String(c.documentId) : null))
                .filter((id): id is string => Boolean(id))
        ),
    ];

    const docs =
        docIds.length === 0
            ? []
            : await prismaClient.document.findMany({
                  where: { userId, id: { in: docIds } },
                  select: {
                      id: true,
                      title: true,
                      ObjectKey: true,
                      modality: true,
                      mimeType: true,
                  },
              });
    const byId = new Map(docs.map((d) => [d.id, d]));

    return chunks.map((c, i) => {
        const docId = c.documentId != null ? String(c.documentId) : null;
        const doc = docId ? byId.get(docId) : undefined;
        return {
            rank: i + 1,
            id: c.id,
            score: c.score,
            text: c.text.slice(0, 450),
            documentId: docId,
            title: doc?.title ?? c.documentTitle ?? undefined,
            modality: c.modality ?? doc?.modality ?? null,
            page: c.page ?? null,
            timestampStart: c.timestampStart ?? null,
            timestampEnd: c.timestampEnd ?? null,
            caption: c.caption ?? null,
            objectKey: doc?.ObjectKey ?? null,
            mimeType: doc?.mimeType ?? null,
        } as GroundedSource & { mimeType?: string | null };
    });
}

export function buildCitationSystemAddendum(): string {
    return `
When you cite context chunks, use [n] matching the chunk rank.
If a chunk includes page numbers, reference them (e.g. [1] p.4).
If a chunk includes timestamps (audio/video), reference them (e.g. [2] at 1:12).
Prefer grounded claims over general knowledge.
`;
}

/** Map RetrievedChunk list after rerank into grounded sources. */
export async function groundedSourcesFromChunks(
    userId: string,
    topChunks: RetrievedChunk[]
): Promise<(GroundedSource & { mimeType?: string | null })[]> {
    return enrichSourcesWithDocuments(userId, topChunks);
}
