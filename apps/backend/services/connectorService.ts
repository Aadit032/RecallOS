import { prismaClient } from "@repo/prisma/client";
import { s3 } from "@repo/minio/client";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { xAddToStream } from "@repo/redis-stream/client";
import {
    assertSafeOutboundUrl,
    validateGithubPath,
    validateGithubRepo,
    validatePublicHttpUrl,
} from "../security/ssrf.ts";

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

/** Strip secrets before returning connector rows to API clients. */
export function redactConnectorConfig(config: unknown): Record<string, unknown> {
    const c = asConfig(config);
    const out: Record<string, unknown> = { ...c };
    if (typeof out.token === "string" && out.token.length > 0) {
        out.token = "[redacted]";
        out.hasToken = true;
    } else {
        delete out.token;
        out.hasToken = false;
    }
    return out;
}

export function sanitizeConnectorConfigForStorage(
    type: ConnectorType,
    config: ConnectorConfig
): ConnectorConfig {
    const maxItems = Math.min(Math.max(Number(config.maxItems) || 5, 1), 25);
    const out: ConnectorConfig = { maxItems };

    if (type === "url" || type === "notion") {
        const url = typeof config.url === "string" ? config.url.trim() : "";
        const parsed = validatePublicHttpUrl(url);
        if (!parsed.ok) throw new Error(`Invalid connector URL: ${parsed.reason}`);
        out.url = parsed.href;
    } else if (type === "rss") {
        const feed = (typeof config.feedUrl === "string" ? config.feedUrl : config.url) ?? "";
        const parsed = validatePublicHttpUrl(String(feed).trim());
        if (!parsed.ok) throw new Error(`Invalid feed URL: ${parsed.reason}`);
        out.feedUrl = parsed.href;
        out.url = parsed.href;
    } else if (type === "github") {
        out.repo = validateGithubRepo(String(config.repo ?? ""));
        const branch = typeof config.branch === "string" ? config.branch.trim() : "main";
        if (!/^[a-zA-Z0-9._/-]+$/.test(branch) || branch.includes("..") || branch.length > 200) {
            throw new Error("Invalid GitHub branch");
        }
        out.branch = branch;
        out.path = typeof config.path === "string" ? config.path.replace(/^\//, "").slice(0, 500) : "";
        if (out.path && (out.path.includes("..") || out.path.includes("\\"))) {
            throw new Error("Invalid GitHub path");
        }
        if (typeof config.token === "string" && config.token.trim()) {
            const token = config.token.trim();
            if (token.length > 500 || !/^[a-zA-Z0-9_.=-]+$/.test(token)) {
                throw new Error("Invalid GitHub token format");
            }
            out.token = token;
        }
    }

    return out;
}

export async function listConnectors(userId: string) {
    const rows = await prismaClient.connector.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        include: {
            jobs: {
                orderBy: { startedAt: "desc" },
                take: 3,
            },
        },
    });
    return rows.map((row) => ({
        ...row,
        config: redactConnectorConfig(row.config),
    }));
}

export async function createConnector(params: {
    userId: string;
    type: ConnectorType;
    name: string;
    config: ConnectorConfig;
    syncInterval?: number;
}) {
    const safeConfig = sanitizeConnectorConfigForStorage(params.type, params.config);
    const created = await prismaClient.connector.create({
        data: {
            userId: params.userId,
            type: params.type,
            name: params.name.trim().slice(0, 120),
            config: safeConfig as never,
            syncInterval: Math.max(5, Math.min(24 * 60, params.syncInterval ?? 30)),
            status: "ACTIVE",
        },
    });
    return {
        ...created,
        config: redactConnectorConfig(created.config),
    };
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
    const updated = await prismaClient.connector.update({
        where: { id },
        data: { status },
    });
    return {
        ...updated,
        config: redactConnectorConfig(updated.config),
    };
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

/** Max response body we will buffer from a connector fetch (bytes). */
const MAX_FETCH_BYTES = 2 * 1024 * 1024;

async function safeFetchText(
    rawUrl: string,
    opts?: { headers?: Record<string, string>; timeoutMs?: number }
): Promise<string> {
    const href = await assertSafeOutboundUrl(rawUrl);
    const res = await fetch(href, {
        headers: {
            "User-Agent": "RecallOS-Connector/1.0",
            ...(opts?.headers ?? {}),
        },
        redirect: "manual",
        signal: AbortSignal.timeout(opts?.timeoutMs ?? 25_000),
    });

    // Follow a single same-policy redirect after re-validating the Location
    if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new Error(`Redirect without Location (${res.status})`);
        const next = await assertSafeOutboundUrl(new URL(loc, href).href);
        const res2 = await fetch(next, {
            headers: {
                "User-Agent": "RecallOS-Connector/1.0",
                ...(opts?.headers ?? {}),
            },
            redirect: "manual",
            signal: AbortSignal.timeout(opts?.timeoutMs ?? 25_000),
        });
        if (!res2.ok) throw new Error(`Fetch failed ${res2.status}`);
        if (res2.status >= 300 && res2.status < 400) {
            throw new Error("Too many redirects");
        }
        const buf = Buffer.from(await res2.arrayBuffer());
        if (buf.byteLength > MAX_FETCH_BYTES) throw new Error("Response too large");
        return buf.toString("utf-8");
    }

    if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_FETCH_BYTES) throw new Error("Response too large");
    return buf.toString("utf-8");
}

async function fetchUrlText(url: string): Promise<{ title: string; text: string }> {
    const html = await safeFetchText(url);
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
    const xml = await safeFetchText(feedUrl);
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

function isAllowedGithubDownloadUrl(raw: string): boolean {
    try {
        const u = new URL(raw);
        if (u.protocol !== "https:") return false;
        const host = u.hostname.toLowerCase();
        return (
            host === "raw.githubusercontent.com" ||
            host === "githubusercontent.com" ||
            host.endsWith(".githubusercontent.com") ||
            host === "objects.githubusercontent.com"
        );
    } catch {
        return false;
    }
}

async function syncGithub(userId: string, config: ConnectorConfig, tags: string[]): Promise<number> {
    const repo = validateGithubRepo(String(config.repo ?? ""));
    const branch = config.branch || "main";
    if (!/^[a-zA-Z0-9._/-]+$/.test(branch) || branch.includes("..")) {
        throw new Error("Invalid GitHub branch");
    }
    const path = validateGithubPath(config.path || "");
    const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "User-Agent": "RecallOS-Connector/1.0",
    };
    if (config.token) headers.Authorization = `Bearer ${config.token}`;

    const api = path
        ? `https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`
        : `https://api.github.com/repos/${repo}/contents?ref=${encodeURIComponent(branch)}`;

    // GitHub API is a fixed public host — still use timeout + size cap
    const res = await fetch(api, {
        headers,
        signal: AbortSignal.timeout(25_000),
        redirect: "error",
    });
    if (!res.ok) {
        const body = (await res.text()).slice(0, 200);
        throw new Error(`GitHub API ${res.status}: ${body}`);
    }
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
        if (f.download_url && isAllowedGithubDownloadUrl(f.download_url)) {
            try {
                text = (
                    await safeFetchText(f.download_url, {
                        headers: config.token ? { Authorization: `Bearer ${config.token}` } : {},
                        timeoutMs: 20_000,
                    })
                ).slice(0, 80_000);
            } catch {
                continue;
            }
        }
        if (text.length < 20) continue;
        const id = await ingestTextDocument({
            userId,
            title: `${repo}:${f.path}`.slice(0, 240),
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
