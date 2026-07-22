import fs from "fs";
import path from "path";
import { openrouterClient } from "@repo/openrouter/client";
import { audioFormatFromExt } from "./temp.ts";

const WHISPER_MODEL =
    (process.env.WHISPER_MODEL as string) || "openai/whisper-large-v3";

/** Multipart upload max is 25 MB; larger files go through base64 JSON. */
const MULTIPART_MAX_BYTES = 25 * 1024 * 1024;

export type TranscriptSegment = {
    start: number;
    end: number;
    text: string;
};

export type TranscriptResult = {
    text: string;
    duration?: number;
    language?: string;
    segments: TranscriptSegment[];
};

/**
 * Transcribe an audio file via OpenRouter STT (Whisper-compatible).
 * Prefers multipart for small files; falls back to base64 input_audio for larger ones.
 */
export async function transcribeAudioFile(
    filePath: string,
    opts?: { language?: string }
): Promise<TranscriptResult> {
    if (!WHISPER_MODEL) {
        throw new Error("WHISPER_MODEL is not set");
    }

    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).replace(/^\./, "") || "mp3";
    const format = audioFormatFromExt(ext);
    const fileName = path.basename(filePath);

    let result;
    if (stat.size <= MULTIPART_MAX_BYTES) {
        const bytes = fs.readFileSync(filePath);
        result = await openrouterClient.stt.createTranscriptionMultipart({
            requestBody: {
                file: {
                    fileName,
                    content: bytes,
                },
                model: WHISPER_MODEL,
                language: opts?.language,
                responseFormat: "verbose_json",
                timestampGranularities: ["segment"],
            },
        });
    } else {
        const data = fs.readFileSync(filePath).toString("base64");
        result = await openrouterClient.stt.createTranscription({
            sttRequest: {
                model: WHISPER_MODEL,
                language: opts?.language,
                responseFormat: "verbose_json",
                timestampGranularities: ["segment"],
                inputAudio: { data, format },
            },
        });
    }

    const text = (result.text ?? "").trim();
    const segments: TranscriptSegment[] = (result.segments ?? [])
        .map((s) => ({
            start: s.start,
            end: s.end,
            text: (s.text ?? "").trim(),
        }))
        .filter((s) => s.text.length > 0);

    return {
        text,
        duration: result.duration,
        language: result.language,
        segments,
    };
}

export type TimedChunk = {
    text: string;
    timestampStart: number | null;
    timestampEnd: number | null;
};

/**
 * Group transcript segments into ~maxChars chunks, preserving time bounds.
 * Falls back to plain character windows when no segments are available.
 */
export function chunkTranscript(
    transcript: TranscriptResult,
    maxChars = 2500,
    overlapChars = 200
): TimedChunk[] {
    if (transcript.segments.length > 0) {
        return chunkFromSegments(transcript.segments, maxChars);
    }
    return chunkPlainText(transcript.text, maxChars, overlapChars);
}

function chunkFromSegments(segments: TranscriptSegment[], maxChars: number): TimedChunk[] {
    const chunks: TimedChunk[] = [];
    let buf = "";
    let start: number | null = null;
    let end: number | null = null;

    const flush = () => {
        const text = buf.trim();
        if (!text) return;
        chunks.push({ text, timestampStart: start, timestampEnd: end });
        buf = "";
        start = null;
        end = null;
    };

    for (const seg of segments) {
        const piece = seg.text.trim();
        if (!piece) continue;
        const next = buf ? `${buf} ${piece}` : piece;
        if (buf && next.length > maxChars) {
            flush();
            buf = piece;
            start = seg.start;
            end = seg.end;
        } else {
            if (start === null) start = seg.start;
            end = seg.end;
            buf = next;
        }
    }
    flush();
    return chunks;
}

function chunkPlainText(text: string, maxChars: number, overlapChars: number): TimedChunk[] {
    const cleaned = text.trim();
    if (!cleaned) return [];
    if (cleaned.length <= maxChars) {
        return [{ text: cleaned, timestampStart: null, timestampEnd: null }];
    }

    const chunks: TimedChunk[] = [];
    let i = 0;
    while (i < cleaned.length) {
        let end = Math.min(i + maxChars, cleaned.length);
        if (end < cleaned.length) {
            // Prefer break at sentence / whitespace
            const slice = cleaned.slice(i, end);
            const breakAt = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
            if (breakAt > maxChars * 0.4) {
                end = i + breakAt + 1;
            }
        }
        const piece = cleaned.slice(i, end).trim();
        if (piece) chunks.push({ text: piece, timestampStart: null, timestampEnd: null });
        if (end >= cleaned.length) break;
        i = Math.max(end - overlapChars, i + 1);
    }
    return chunks;
}
