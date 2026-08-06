/**
 * Upload security policy: MIME allowlist, size caps, user-scoped object keys.
 */

/** Max object size accepted for confirm + enforced where possible on presign (bytes). */
export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 100 * 1024 * 1024); // 100 MiB

const ALLOWED_MIME = new Set([
  // documents
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  // images
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/tiff",
  // audio
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/m4a",
  "audio/aac",
  "audio/flac",
  "audio/ogg",
  "audio/webm",
  // video
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
  "video/x-msvideo",
]);

export function isAllowedMimeType(mime: string): boolean {
  const normalized = mime.trim().toLowerCase().split(";")[0]!.trim();
  return ALLOWED_MIME.has(normalized);
}

export function normalizeMimeType(mime: string): string {
  return mime.trim().toLowerCase().split(";")[0]!.trim();
}

/** Map MIME → modality folder segment. */
export function modalityFolder(mimeType: string): "pdf" | "image" | "audio" | "video" {
  const m = normalizeMimeType(mimeType);
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  return "pdf";
}

/**
 * Build a user-scoped S3 object key.
 * Format: `uploads/{userId}/{modality}/{uuid}-{safeFileName}`
 * Confirm must reject any key not matching this user's prefix.
 */
export function buildUploadObjectKey(
  userId: string,
  mimeType: string,
  fileName: string
): string {
  const safeUserId = sanitizePathSegment(userId);
  const safeFileName = sanitizeFileName(fileName);
  const folder = modalityFolder(mimeType);
  return `uploads/${safeUserId}/${folder}/${crypto.randomUUID()}-${safeFileName}`;
}

export function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? "file";
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
  return safe.length > 0 ? safe : "file";
}

function sanitizePathSegment(seg: string): string {
  return seg.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "user";
}

/**
 * Ensure the object key belongs to this user and matches expected layout.
 */
export function assertOwnedUploadKey(userId: string, key: string): void {
  if (typeof key !== "string" || key.length === 0 || key.length > 512) {
    throw new Error("Invalid object key");
  }
  if (key.includes("..") || key.includes("\\") || key.startsWith("/")) {
    throw new Error("Invalid object key");
  }
  const safeUserId = sanitizePathSegment(userId);
  const prefix = `uploads/${safeUserId}/`;
  if (!key.startsWith(prefix)) {
    throw new Error("Object key is not owned by the authenticated user");
  }
  const rest = key.slice(prefix.length);
  const modality = rest.split("/")[0];
  if (!modality || !["pdf", "image", "audio", "video"].includes(modality)) {
    throw new Error("Invalid object key modality segment");
  }
}
