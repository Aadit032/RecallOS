import { Router } from "express";
import { prismaClient } from "@repo/prisma/client";
import { hybridRetrieve } from "../services/hybridRetrieve.ts";
import { aggregateByDocument } from "../services/searchService.ts";
import { searchSchema } from "../types.ts";

const searchRouter = Router();

const SEARCH_CHUNK_LIMIT = 150;

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
