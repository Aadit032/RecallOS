import fs from "fs";
import path from "path";

const SCENE_THRESHOLD = Number(process.env.SCENE_THRESHOLD ?? "0.35");
/** Split scenes longer than this into fixed windows (seconds). */
const MAX_SCENE_SEC = Number(process.env.MAX_SCENE_SEC ?? "45");
/** Drop / merge scenes shorter than this (seconds). */
const MIN_SCENE_SEC = Number(process.env.MIN_SCENE_SEC ?? "1.5");

export type SceneRange = {
    index: number;
    start: number;
    end: number;
};

async function runCmd(
    cmd: string[],
    opts?: { allowNonZero?: boolean }
): Promise<{ stdout: string; stderr: string; code: number }> {
    const proc = Bun.spawn(cmd, {
        stdout: "pipe",
        stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    if (code !== 0 && !opts?.allowNonZero) {
        throw new Error(`Command failed (${code}): ${cmd.join(" ")}\n${stderr.slice(-2000)}`);
    }
    return { stdout, stderr, code };
}

/** Media duration in seconds via ffprobe. */
export async function getDurationSeconds(mediaPath: string): Promise<number> {
    const { stdout } = await runCmd([
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        mediaPath,
    ]);
    const d = parseFloat(stdout.trim());
    if (!Number.isFinite(d) || d <= 0) {
        throw new Error(`Could not read duration for ${mediaPath}: "${stdout.trim()}"`);
    }
    return d;
}

/** Whether the file has at least one audio stream. */
export async function hasAudioStream(mediaPath: string): Promise<boolean> {
    const { stdout, code } = await runCmd(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "a",
            "-show_entries",
            "stream=index",
            "-of",
            "csv=p=0",
            mediaPath,
        ],
        { allowNonZero: true }
    );
    return code === 0 && stdout.trim().length > 0;
}

/**
 * Detect scene cut points with ffmpeg's scene score filter, then build
 * [start, end) ranges. Long scenes are split; tiny scenes are merged.
 */
export async function detectScenes(
    videoPath: string,
    threshold = SCENE_THRESHOLD
): Promise<SceneRange[]> {
    const duration = await getDurationSeconds(videoPath);

    const { stderr } = await runCmd(
        [
            "ffmpeg",
            "-hide_banner",
            "-i",
            videoPath,
            "-filter:v",
            `select='gt(scene,${threshold})',showinfo`,
            "-an",
            "-f",
            "null",
            "-",
        ],
        { allowNonZero: true }
    );

    const cutTimes: number[] = [];
    for (const m of stderr.matchAll(/pts_time:\s*([0-9]+(?:\.[0-9]+)?)/g)) {
        const t = parseFloat(m[1]!);
        if (Number.isFinite(t) && t > 0.25 && t < duration - 0.25) cutTimes.push(t);
    }

    // Deduplicate near-identical cuts
    cutTimes.sort((a, b) => a - b);
    const uniqueCuts: number[] = [];
    for (const t of cutTimes) {
        if (uniqueCuts.length === 0 || t - uniqueCuts[uniqueCuts.length - 1]! > 0.4) uniqueCuts.push(t);
    }

    const bounds = [0, ...uniqueCuts, duration];
    let ranges: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < bounds.length - 1; i++) {
        const start = bounds[i]!;
        const end = bounds[i + 1]!;
        if (end - start >= MIN_SCENE_SEC * 0.5) ranges.push({ start, end });
    }

    if (ranges.length === 0) ranges = [{ start: 0, end: duration }];

    // Split long scenes
    const split: Array<{ start: number; end: number }> = [];
    for (const r of ranges) {
        const len = r.end - r.start;
        if (len <= MAX_SCENE_SEC) {
            split.push(r);
            continue;
        }
        let s = r.start;
        while (s < r.end - MIN_SCENE_SEC) {
            const e = Math.min(s + MAX_SCENE_SEC, r.end);
            split.push({ start: s, end: e });
            s = e;
        }
    }

    // Merge tiny trailing fragments into previous
    const merged: Array<{ start: number; end: number }> = [];
    for (const r of split) {
        if (merged.length > 0 && r.end - r.start < MIN_SCENE_SEC) merged[merged.length - 1]!.end = r.end;
        else merged.push({ ...r });
    }

    return merged.map((r, index) => ({
        index,
        start: Math.round(r.start * 1000) / 1000,
        end: Math.round(r.end * 1000) / 1000,
    }));
}

/** Extract a single JPEG keyframe near the midpoint of [start, end]. */
export async function extractKeyframe(
    videoPath: string,
    start: number,
    end: number,
    outPath: string
): Promise<string> {
    const mid = Math.max(0, (start + end) / 2);
    // Seek after -ss for accurate decode near cuts; -ss before -i is faster but less precise
    await runCmd([
        "ffmpeg",
        "-hide_banner",
        "-y",
        "-ss",
        String(mid),
        "-i",
        videoPath,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        outPath,
    ]);
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) throw new Error(`Keyframe extraction failed: ${outPath}`);
    return outPath;
}

/** Extract an audio clip [start, end] as mp3. Returns null if no audio or clip too short. */
export async function extractAudioClip(
    videoPath: string,
    start: number,
    end: number,
    outDir: string
): Promise<string | null> {
    const duration = end - start;
    if (duration < 0.4) return null;
    if (!(await hasAudioStream(videoPath))) return null;

    const outPath = path.join(outDir, `clip-${start.toFixed(2)}-${end.toFixed(2)}.mp3`);
    await runCmd([
        "ffmpeg",
        "-hide_banner",
        "-y",
        "-ss",
        String(start),
        "-to",
        String(end),
        "-i",
        videoPath,
        "-vn",
        "-acodec",
        "libmp3lame",
        "-q:a",
        "4",
        outPath,
    ]);

    if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 100) {
        try {
            fs.unlinkSync(outPath);
        } catch {
            /* ignore */
        }
        return null;
    }
    return outPath;
}