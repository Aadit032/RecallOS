import { Router } from "express";
import { prismaClient } from "@repo/prisma/client";
import { hybridRetrieve, type RetrievedChunk } from "../services/hybridRetrieve.ts";
import { searchSchema } from "../types.ts";

const searchRouter = Router();

const SEARCH_CHUNK_LIMIT = 150;
const SNIPPET_MAX = 320;

/** Strip the cheap metadata header so the UI shows content, not "Document: …". */
function snippetFromChunk(text: string): string {
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

type AggregatedDoc = {
    documentId: string;
    score: number;
    snippet: string | null;
    bestChunk: RetrievedChunk;
};

/**
 * Group hybrid chunks by documentId, keep max score + best snippet.
 */
function aggregateByDocument(chunks: RetrievedChunk[]): AggregatedDoc[] {
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

/**
 * POST /api/v1/search
 * Natural-language document search over the user's indexed library.
 * Returns top N documents (not raw chunks) with load-more via offset.
 */
searchRouter.post("/", async (req, res) => {
    const userId = req.userId;
    if (!userId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }

    const parsed = searchSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ message: "Invalid request body" });
        return;
    }

    const { query, modality } = parsed.data;
    const limit = parsed.data.limit ?? 10;
    const offset = parsed.data.offset ?? 0;

    console.log(`[search] userId=${userId} query="${query.slice(0, 120)}" limit=${limit} offset=${offset} modality=${modality ?? "any"}`);

    try {
        const chunks = await hybridRetrieve(userId, query, {
            limit: SEARCH_CHUNK_LIMIT,
            modality,
        });

        const aggregated = aggregateByDocument(chunks);
        const pageSlice = aggregated.slice(offset, offset + limit);
        const hasMore = offset + limit < aggregated.length;
        const nextOffset = hasMore ? offset + limit : null;

        const ids = pageSlice.map((a) => a.documentId);
        const docs =
            ids.length === 0
                ? []
                : await prismaClient.document.findMany({
                      where: { userId, id: { in: ids } },
                      select: {
                          id: true,
                          title: true,
                          ObjectKey: true,
                          modality: true,
                          mimeType: true,
                          tags: true,
                          status: true,
                          createdAt: true,
                      },
                  });

        const byId = new Map(docs.map((d) => [d.id, d]));

        const documents = pageSlice
            .map((agg) => {
                const doc = byId.get(agg.documentId);
                if (!doc) return null;
                return {
                    id: doc.id,
                    title: doc.title,
                    ObjectKey: doc.ObjectKey,
                    modality: doc.modality,
                    mimeType: doc.mimeType,
                    tags: doc.tags,
                    status: doc.status,
                    createdAt: doc.createdAt,
                    score: agg.score,
                    snippet: agg.snippet,
                };
            })
            .filter((d): d is NonNullable<typeof d> => d !== null);

        console.log(`[search] aggregated=${aggregated.length} returning=${documents.length} hasMore=${hasMore}`);

        res.status(200).json({
            documents,
            offset,
            limit,
            hasMore,
            nextOffset,
            totalMatched: aggregated.length,
        });
    } catch (e) {
        console.error(`[search] Failed:`, e);
        res.status(500).json({
            message: "Search failed",
            error: e instanceof Error ? e.message : String(e),
        });
    }
});

export default searchRouter;
