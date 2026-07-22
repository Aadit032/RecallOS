import fs from "fs";
import path from "path";
import os from "os";

/** Create a unique temp directory under the OS tmp dir. */
export function makeTempDir(prefix = "recallos-"): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Best-effort recursive delete of a temp path. */
export function cleanupTemp(dirOrFile: string | null | undefined): void {
    if (!dirOrFile) return;
    try {
        fs.rmSync(dirOrFile, { recursive: true, force: true });
    } catch {
        // ignore cleanup failures
    }
}

/** Extension from an object key or filename (no leading dot). Falls back to `fallback`. */
export function extFromKey(key: string, fallback = "bin"): string {
    const base = key.split("/").pop() ?? key;
    const dot = base.lastIndexOf(".");
    if (dot <= 0 || dot === base.length - 1) return fallback;
    return base.slice(dot + 1).toLowerCase();
}

/** Guess a MIME type from a file extension. */
export function mimeFromExt(ext: string): string {
    const map: Record<string, string> = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        bmp: "image/bmp",
        tiff: "image/tiff",
        tif: "image/tiff",
        mp3: "audio/mpeg",
        wav: "audio/wav",
        m4a: "audio/mp4",
        aac: "audio/aac",
        flac: "audio/flac",
        ogg: "audio/ogg",
        webm: "audio/webm",
        mp4: "video/mp4",
        mov: "video/quicktime",
        mkv: "video/x-matroska",
        avi: "video/x-msvideo",
    };
    return map[ext.toLowerCase()] ?? "application/octet-stream";
}

/** Map extension → OpenRouter STT `format` field. */
export function audioFormatFromExt(ext: string): string {
    const e = ext.toLowerCase();
    if (e === "mp3" || e === "mpeg") return "mp3";
    if (e === "wav") return "wav";
    if (e === "m4a" || e === "mp4") return "m4a";
    if (e === "flac") return "flac";
    if (e === "ogg" || e === "oga") return "ogg";
    if (e === "webm") return "webm";
    if (e === "aac") return "aac";
    return e || "mp3";
}

/** Read a file as a base64 data URL for vision models. */
export function fileToDataUrl(filePath: string, mime: string): string {
    const buf = fs.readFileSync(filePath);
    return `data:${mime};base64,${buf.toString("base64")}`;
}
