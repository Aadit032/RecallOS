import { qdrantClient } from "@repo/qdrant/client";
import { prismaClient } from "@repo/prisma/client";
import { getDenseVectors, getSparseVectors } from "@repo/embed/client";
import { startActiveObservation, truncateForTrace } from "@repo/langfuse/client";

const COLLECTION = process.env.COLLECTION as string;
const DEFAULT_RETRIEVAL_LIMIT = 50;

export type RetrievedChunk = {
    id: string;
    text: string;
    score: number;
    documentId?: string | number | null;
    documentTitle?: string | null;
    tags?: string[] | null;
    modality?: string | null;
};

export type HybridRetrieveOptions = {
    /** Max RRF points to return (default 50). Use higher values for document search aggregation. */
    limit?: number;
    modality?: string;
};

/**
 * Hybrid retrieval: dense (cosine) + sparse (SPLADE), fused with RRF in Qdrant.
 * Scoped to the requesting user's chunks only.
 */
export async function hybridRetrieve(
    userId: string,
    query: string,
    options: HybridRetrieveOptions | string = {}
): Promise<RetrievedChunk[]> {
    // Back-compat: chat used to pass modality as the third positional arg
    const opts: HybridRetrieveOptions = typeof options === "string" ? { modality: options } : options;
    const limit = Math.min(Math.max(opts.limit ?? DEFAULT_RETRIEVAL_LIMIT, 1), 200);
    const modality = opts.modality;

    return startActiveObservation(
        "hybrid-retrieve",
        async (retriever) => {
            retriever.update({
                input: { userId, query: truncateForTrace(query, 500) },
                metadata: {
                    collection: COLLECTION,
                    limit,
                    fusion: "rrf",
                    modality: modality ?? null,
                },
            });

            const ownedDocuments = await prismaClient.document.findMany({
                where: { userId },
                select: { id: true },
            });
            const ownedDocumentIds = ownedDocuments.map((doc) => doc.id);
            if (ownedDocumentIds.length === 0) {
                console.log(`[hybridRetrieve] No documents for userId=${userId}, skipping retrieval`);
                retriever.update({ output: { chunkCount: 0, reason: "no-documents" } });
                return [];
            }

            const mustConditions: Record<string, unknown>[] = [ { key: "documentId", match: { any: ownedDocumentIds } } ];
            if (modality) mustConditions.push({ key: "modality", match: { value: modality } });
            
            const filter = { must: mustConditions };

            console.log(`[hybridRetrieve] Starting retrieval for userId=${userId}, query: "${query.slice(0, 120)}"`);
            const [denseVectors, sparseVectors] = await Promise.all([
                getDenseVectors([query]),
                getSparseVectors([query]),
            ]);
            console.log(
                `[hybridRetrieve] Dense vector dims: ${denseVectors[0]?.length ?? 0}, Sparse vector nnz: ${sparseVectors[0]?.indices?.length ?? 0}`
            );

            const denseVector = denseVectors[0];
            const sparse = sparseVectors[0];

            if (!denseVector || !sparse) {
                console.error("[hybridRetrieve] Failed to embed query — no vectors returned");
                throw new Error("Failed to embed query");
            }

            const rawIndices = Array.from(sparse.indices as Iterable<number>);
            const rawValues = Array.from(sparse.values as Iterable<number>);
            const paired = rawIndices
                .map((idx, i) => ({ idx, val: rawValues[i] ?? 0 }))
                .filter((p) => p.val !== 0)
                .sort((a, b) => a.idx - b.idx);
            const sparseQuery = {
                indices: paired.map((p) => p.idx),
                values: paired.map((p) => p.val),
            };

            const denseQuery = Array.from(denseVector as ArrayLike<number>);

            if (denseQuery.some((v) => !Number.isFinite(v))) {
                console.error("[hybridRetrieve] Dense vector contains NaN or Infinity");
                throw new Error("Dense vector contains invalid values");
            }
            if (sparseQuery.indices.length === 0) {
                console.error("[hybridRetrieve] Sparse vector has no non-zero entries");
                throw new Error("Sparse vector is empty");
            }

            console.log(
                `[hybridRetrieve] Querying Qdrant collection "${COLLECTION}" with dense (${denseQuery.length}d) + sparse (${sparseQuery.indices.length} nnz) RRF, limit=${limit}, userId=${userId}, documents=${ownedDocumentIds.length}`
            );
            let res;
            try {
                res = await qdrantClient.query(COLLECTION, {
                    prefetch: [
                        {
                            query: denseQuery,
                            using: "dense",
                            limit,
                            filter,
                        },
                        {
                            query: sparseQuery,
                            using: "splade",
                            limit,
                            filter,
                        },
                    ],
                    query: { fusion: "rrf" },
                    limit,
                    filter,
                    with_payload: true,
                });
            } catch (qdrantErr: any) {
                console.error(`[hybridRetrieve] Qdrant query failed:`, {
                    message: qdrantErr.message,
                    status: qdrantErr.status,
                    statusText: qdrantErr.statusText,
                    data: JSON.stringify(qdrantErr.data),
                });
                throw qdrantErr;
            }

            const rawChunks = (res.points ?? [])
                .map((point) => {
                    const payload = (point.payload ?? {}) as Record<string, unknown>;
                    const tagsRaw = payload.tags;
                    const tags = Array.isArray(tagsRaw)
                        ? tagsRaw.filter((t): t is string => typeof t === "string")
                        : null;
                    return {
                        id: String(point.id),
                        text: typeof payload.text === "string" ? payload.text : "",
                        score: point.score ?? 0,
                        documentId: (payload.documentId as string | number | undefined) ?? null,
                        documentTitle:
                            typeof payload.documentTitle === "string"
                                ? payload.documentTitle
                                : null,
                        tags,
                        modality:
                            typeof payload.modality === "string" ? payload.modality : null,
                        payloadUserId:
                            typeof payload.userId === "string" ? payload.userId : null,
                    };
                })
                .filter((c) => c.text.length > 0);

            const ownedDocumentIdSet = new Set(ownedDocumentIds);

            const chunks = rawChunks
                .filter((c) => {
                    const docId = c.documentId == null ? null : String(c.documentId);
                    if (!docId || !ownedDocumentIdSet.has(docId)) return false;
                    return c.payloadUserId == null || c.payloadUserId === userId;
                })
                .map(({ payloadUserId: _payloadUserId, ...chunk }) => chunk);

            console.log(
                `[hybridRetrieve] Qdrant returned ${res.points?.length ?? 0} RRF points, ${chunks.length} user-scoped chunks with text`
            );

            retriever.update({
                output: {
                    chunkCount: chunks.length,
                    topScores: chunks.slice(0, 5).map((c) => ({
                        id: c.id,
                        score: c.score,
                    })),
                },
            });

            return chunks;
        },
        { asType: "retriever" }
    );
}
