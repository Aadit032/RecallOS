/**
 * SSRF protections for user-supplied URLs (connectors, RSS, etc.).
 * Blocks non-http(s), credentials-in-URL, private/link-local/metadata hosts,
 * and optional DNS rebinding via post-resolve IP checks when available.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
  "0.0.0.0",
]);

/** IPv4 private / special-use ranges we never allow outbound fetch to. */
function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];

  // 0.0.0.0/8, 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // CGNAT / shared address space 100.64/10
  if (a === 100 && b >= 64 && b <= 127) return true;
  // Multicast / reserved
  if (a >= 224) return true;
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  // Unique local fc00::/7, link-local fe80::/10
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
      normalized.startsWith("fea") || normalized.startsWith("feb")) {
    return true;
  }
  // IPv4-mapped :ffff:x.x.x.x
  const mapped = normalized.match(/^:ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped?.[1] && isBlockedIpv4(mapped[1])) return true;
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedIpv4(ip);
  if (version === 6) return isBlockedIpv6(ip);
  return true;
}

export type SafeUrlResult =
  | { ok: true; url: URL; href: string }
  | { ok: false; reason: string };

/**
 * Parse and statically validate a user-supplied URL (no DNS yet).
 */
export function validatePublicHttpUrl(raw: string): SafeUrlResult {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) {
    return { ok: false, reason: "Invalid URL length" };
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "Malformed URL" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Only http(s) URLs are allowed" };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "URLs with credentials are not allowed" };
  }
  if (url.port && !["", "80", "443"].includes(url.port)) {
    // Allow only default web ports to reduce scan surface
    const port = Number(url.port);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      return { ok: false, reason: "Invalid port" };
    }
    // Block common internal service ports; still allow alternate HTTPS if needed
    // Prefer strict defaults for connector SSRF.
    if (![80, 443, 8080, 8443].includes(port)) {
      return { ok: false, reason: "Port not allowed" };
    }
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || BLOCKED_HOSTNAMES.has(host)) {
    return { ok: false, reason: "Blocked hostname" };
  }
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) {
    return { ok: false, reason: "Blocked hostname suffix" };
  }

  // Literal IP host
  if (isIP(host)) {
    if (isBlockedIp(host)) {
      return { ok: false, reason: "Private or special-use IP not allowed" };
    }
  }

  return { ok: true, url, href: url.href };
}

/**
 * Resolve hostname and reject if any address is private/special-use.
 * Call before fetch to mitigate DNS rebinding to internal networks.
 */
export async function assertUrlResolvesPublic(url: URL): Promise<void> {
  const host = url.hostname;
  if (isIP(host)) {
    if (isBlockedIp(host)) {
      throw new Error("Resolved address is not publicly routable");
    }
    return;
  }

  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("DNS resolution failed for host");
  }

  if (!addresses.length) {
    throw new Error("DNS resolution returned no addresses");
  }

  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new Error("Host resolves to a private or special-use address");
    }
  }
}

/**
 * Validate + DNS-check a URL for safe outbound fetch.
 */
export async function assertSafeOutboundUrl(raw: string): Promise<string> {
  const parsed = validatePublicHttpUrl(raw);
  if (!parsed.ok) {
    throw new Error(`Unsafe URL: ${parsed.reason}`);
  }
  await assertUrlResolvesPublic(parsed.url);
  return parsed.href;
}

/** GitHub owner/repo path: owner/name only. */
const GITHUB_REPO_RE = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

export function validateGithubRepo(repo: string): string {
  const trimmed = repo.trim();
  if (!GITHUB_REPO_RE.test(trimmed) || trimmed.includes("..")) {
    throw new Error("Invalid GitHub repo; expected owner/name");
  }
  return trimmed;
}

/** Safe GitHub content path (no leading slash, no ..). */
export function validateGithubPath(path: string): string {
  const p = path.replace(/^\/+/, "").trim();
  if (!p) return "";
  if (p.includes("..") || p.includes("\\") || p.length > 500) {
    throw new Error("Invalid GitHub path");
  }
  // Encode each segment for API path
  return p
    .split("/")
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}
