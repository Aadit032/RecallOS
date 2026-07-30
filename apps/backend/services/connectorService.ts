import { prismaClient } from "@repo/prisma/client";
import { s3 } from "@repo/minio/client";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { xAddToStream } from "@repo/redis-stream/client";
const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME;
const FILES_STREAM = process.env.FILES_STREAM ?? "files_stream";

export type ConnectorType = "github" | "rss" | "url" | "notion";

export type ConnectorConfig = {
    /** Generic page or Notion public URL */
    url?: string;
    /** RSS/Atom feed URL */
    feedUrl?: string;
    /** GitHub: owner/repo */
    repo?: string;
    /** GitHub: branch (default main) */
    branch?: string;
    /** GitHub: path prefix to sync */
    path?: string;
    /** Optional access token for private GitHub */
    token?: string;
    /** Max items per sync */
    maxItems?: number;
};

function asConfig(raw: unknown): ConnectorConfig {
    if (!raw || typeof raw !== "object") return {};
    return raw as ConnectorConfig;
}

export async function listConnectors(userId: string) {
    return prismaClient.connector.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        include: {
            jobs: {
                orderBy: { startedAt: "desc" },
                take: 3,
            },
        },
    });
}

export async function createConnector(params: {
    userId: string;
    type: ConnectorType;
    name: string;
    config: ConnectorConfig;
    syncInterval?: number;
}) {
    return prismaClient.connector.create({
        data: {
            userId: params.userId,
            type: params.type,
            name: params.name.trim().slice(0, 120),
            config: params.config as never,
            syncInterval: Math.max(5, Math.min(24 * 60, params.syncInterval ?? 30)),
            status: "ACTIVE",
        },
    });
}

export async function deleteConnector(userId: string, id: string) {
    const existing = await prismaClient.connector.findFirst({ where: { id, userId } });
    if (!existing) return false;
    await prismaClient.connector.delete({ where: { id } });
    return true;
}

export async function setConnectorStatus(
    userId: string,
    id: string,
    status: "ACTIVE" | "PAUSED"
) {
    const existing = await prismaClient.connector.findFirst({ where: { id, userId } });
    if (!existing) return null;
    return prismaClient.connector.update({
        where: { id },
        data: { status },
    });
}

async function ingestTextDocument(params: {
    userId: string;
    title: string;
    text: string;
    tags: string[];
    sourceKey: string;
}): Promise<string | null> {
    const key = `connectors/${params.userId}/${params.sourceKey}-${crypto.randomUUID()}.txt`;
    const body = Buffer.from(params.text, "utf-8");

    await s3.send(
        new PutObjectCommand({
            Bucket: AWS_BUCKET_NAME,
            Key: key,
            Body: body,
            ContentType: "text/plain",
        })
    );

    // Workers expect PDF primarily; store as text/plain under pdf modality path
    // by using application/pdf mime only for binary PDFs. For connectors we store
    // plain text and tag modality as pdf so LlamaParse path may fail —
    // instead use image modality? Better: create document with mime text/plain
    // and modality "pdf" won't parse well.
    //
    // Practical approach: write a minimal PDF-like isn't ideal. Store as
    // application/pdf content won't work. Looking at pdf worker — it uses LlamaParse.
    // For connector text, push as document with mimeType text/plain and modality "pdf"
    // and ensure dispatcher handles text... Check dispatcher.
    //
    // Safer: store content in Document.content and also as MinIO object; use
    // image path? Simplest reliable path used in this codebase: upload as
    // text file with mime text/plain — update dispatcher if needed.
    // For now use application/pdf won't work for plain text.
    // We'll use mimeType text/plain + modality "pdf" and add a lightweight
    // text ingest path in confirm... Actually embedder needs ParsedChunkSet.
    //
    // Create ParsedChunkSet directly for connector text to bypass PDF parse.

    const document = await prismaClient.document.create({
        data: {
            title: params.title.slice(0, 240),
            ObjectKey: key,
            userId: params.userId,
            mimeType: "text/plain",
            modality: "pdf",
            status: "PARSED",
            tags: params.tags,
            content: params.text.slice(0, 50_000),
        },
    });

    const chunkSet = await prismaClient.parsedChunkSet.create({
        data: {
            documentId: document.id,
            modality: "pdf",
            status: "PARSED",
            chunks: {
                create: chunkText(params.text).map((text) => ({
                    text: `Document: ${params.title}\nModality: pdf\nTags: ${params.tags.join(", ")}\n---\n${text}`,
                    metadata: {
                        documentTitle: params.title,
                        tags: params.tags,
                        modality: "pdf",
                        source: "connector",
                    },
                })),
            },
        },
    });

    const messageId = await xAddToStream(process.env.EMBED_STREAM ?? "embed_stream", {
        chunkSetId: chunkSet.id,
    });
    if (messageId) {
        await prismaClient.document.update({
            where: { id: document.id },
            data: { status: "EMBEDDING", streamMessageId: messageId },
        });
    }

    return document.id;
}

function chunkText(text: string, size = 1200, overlap = 150): string[] {
    const cleaned = text.replace(/\r\n/g, "\n").trim();
    if (!cleaned) return [];
    if (cleaned.length <= size) return [cleaned];
    const chunks: string[] = [];
    let i = 0;
    while (i < cleaned.length) {
        const end = Math.min(cleaned.length, i + size);
        chunks.push(cleaned.slice(i, end));
        if (end >= cleaned.length) break;
        i = Math.max(0, end - overlap);
    }
    return chunks.slice(0, 40);
}

async function fetchUrlText(url: string): Promise<{ title: string; text: string }> {
    const res = await fetch(url, {
        headers: { "User-Agent": "RecallOS-Connector/1.0" },
        signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch?.[1]?.trim() || url;
    // crude HTML → text
    const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80_000);
    return { title, text };
}

async function syncUrl(userId: string, config: ConnectorConfig, tags: string[]): Promise<number> {
    const url = config.url;
    if (!url) throw new Error("url required");
    const { title, text } = await fetchUrlText(url);
    if (text.length < 40) throw new Error("Page produced too little text");
    const id = await ingestTextDocument({
        userId,
        title,
        text,
        tags,
        sourceKey: "url",
    });
    return id ? 1 : 0;
}

async function syncRss(userId: string, config: ConnectorConfig, tags: string[]): Promise<number> {
    const feedUrl = config.feedUrl || config.url;
    if (!feedUrl) throw new Error("feedUrl required");
    const res = await fetch(feedUrl, {
        headers: { "User-Agent": "RecallOS-Connector/1.0" },
        signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) throw new Error(`RSS fetch failed ${res.status}`);
    const xml = await res.text();
    const items = [...xml.matchAll(/<item[\s\S]*?<\/item>/gi)].slice(0, config.maxItems ?? 5);
    const entries =
        items.length > 0
            ? items
            : [...xml.matchAll(/<entry[\s\S]*?<\/entry>/gi)].slice(0, config.maxItems ?? 5);

    let created = 0;
    for (const m of entries) {
        const block = m[0];
        const title =
            block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim() ||
            "RSS item";
        const link =
            block.match(/<link>([^<]+)<\/link>/i)?.[1]?.trim() ||
            block.match(/<link[^>]+href="([^"]+)"/i)?.[1]?.trim();
        const desc =
            block.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)?.[1] ||
            block.match(/<content[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content>/i)?.[1] ||
            "";
        let text = desc.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (link) {
            try {
                const page = await fetchUrlText(link);
                text = `${text}\n\n${page.text}`.slice(0, 80_000);
            } catch {
                /* keep description */
            }
        }
        if (text.length < 40) continue;
        const id = await ingestTextDocument({
            userId,
            title: title.slice(0, 240),
            text,
            tags: [...tags, "rss"],
            sourceKey: "rss",
        });
        if (id) created += 1;
    }
    return created;
}

async function syncGithub(userId: string, config: ConnectorConfig, tags: string[]): Promise<number> {
    const repo = config.repo;
    if (!repo || !repo.includes("/")) throw new Error("repo must be owner/name");
    const branch = config.branch || "main";
    const path = (config.path || "").replace(/^\//, "");
    const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "User-Agent": "RecallOS-Connector/1.0",
    };
    if (config.token) headers.Authorization = `Bearer ${config.token}`;

    const api = path
        ? `https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`
        : `https://api.github.com/repos/${repo}/contents?ref=${encodeURIComponent(branch)}`;

    const res = await fetch(api, { headers, signal: AbortSignal.timeout(25_000) });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as
        | { type: string; name: string; path: string; download_url?: string }[]
        | { type: string; name: string; path: string; download_url?: string; content?: string; encoding?: string };

    const files = Array.isArray(data) ? data : [data];
    const textFiles = files
        .filter((f) => f.type === "file" && /\.(md|txt|rst|json|ya?ml|ts|tsx|js|py|go|rs)$/i.test(f.name))
        .slice(0, config.maxItems ?? 15);

    let created = 0;
    for (const f of textFiles) {
        let text = "";
        if (f.download_url) {
            const r = await fetch(f.download_url, {
                headers: config.token ? { Authorization: `Bearer ${config.token}` } : {},
                signal: AbortSignal.timeout(20_000),
            });
            if (!r.ok) continue;
            text = (await r.text()).slice(0, 80_000);
        }
        if (text.length < 20) continue;
        const id = await ingestTextDocument({
            userId,
            title: `${repo}:${f.path}`,
            text,
            tags: [...tags, "github", repo],
            sourceKey: "github",
        });
        if (id) created += 1;
    }
    return created;
}

export async function runConnectorSync(connectorId: string): Promise<{
    documentsCreated: number;
    error?: string;
}> {
    const connector = await prismaClient.connector.findUnique({ where: { id: connectorId } });
    if (!connector) return { documentsCreated: 0, error: "Connector not found" };

    const job = await prismaClient.connectorSyncJob.create({
        data: {
            connectorId,
            status: "RUNNING",
        },
    });

    const config = asConfig(connector.config);
    const tags = [`connector:${connector.type}`, `connector-id:${connector.id}`];
    let documentsCreated = 0;
    let error: string | undefined;

    try {
        if (connector.type === "url" || connector.type === "notion") {
            documentsCreated = await syncUrl(connector.userId, config, tags);
        } else if (connector.type === "rss") {
            documentsCreated = await syncRss(connector.userId, config, tags);
        } else if (connector.type === "github") {
            documentsCreated = await syncGithub(connector.userId, config, tags);
        } else {
            throw new Error(`Unsupported connector type: ${connector.type}`);
        }

        await prismaClient.connectorSyncJob.update({
            where: { id: job.id },
            data: {
                status: "SUCCESS",
                documentsCreated,
                finishedAt: new Date(),
            },
        });
        await prismaClient.connector.update({
            where: { id: connectorId },
            data: {
                lastSyncedAt: new Date(),
                lastError: null,
                status: "ACTIVE",
            },
        });
    } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        await prismaClient.connectorSyncJob.update({
            where: { id: job.id },
            data: {
                status: "FAILED",
                error,
                finishedAt: new Date(),
            },
        });
        await prismaClient.connector.update({
            where: { id: connectorId },
            data: {
                lastError: error,
                status: "ERROR",
            },
        });
    }

    return { documentsCreated, error };
}

/**
 * Continuous sync: find ACTIVE connectors past their interval and run them.
 */
export async function runDueConnectorSyncs(limit = 10): Promise<number> {
    const connectors = await prismaClient.connector.findMany({
        where: { status: "ACTIVE" },
        orderBy: { lastSyncedAt: "asc" },
        take: limit * 3,
    });

    const now = Date.now();
    let ran = 0;
    for (const c of connectors) {
        const intervalMs = (c.syncInterval || 30) * 60_000;
        const last = c.lastSyncedAt?.getTime() ?? 0;
        if (now - last < intervalMs) continue;
        await runConnectorSync(c.id);
        ran += 1;
        if (ran >= limit) break;
    }
    return ran;
}
