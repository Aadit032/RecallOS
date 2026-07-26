/**
 * Ensure ffmpeg + ffprobe exist before video/scene workers run.
 * If missing, attempt to install the platform package manager's ffmpeg package.
 *
 * Env:
 *   SKIP_MEDIA_TOOLS_CHECK=1   — skip entirely
 *   SKIP_MEDIA_TOOLS_INSTALL=1 — check only; never install
 *   FFMPEG_PATH / FFPROBE_PATH — optional absolute paths to force
 */

const LOG = "[media-tools]";

/** Resolved absolute (or PATH) names used by ffmpeg.ts helpers. */
let resolvedFfmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
let resolvedFfprobe = process.env.FFPROBE_PATH?.trim() || "ffprobe";

export function getFfmpegBin(): string {
    return resolvedFfmpeg;
}

export function getFfprobeBin(): string {
    return resolvedFfprobe;
}

const CANDIDATE_FFMPEG = [
    process.env.FFMPEG_PATH,
    "ffmpeg",
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/opt/homebrew/bin/ffmpeg",
    "/opt/local/bin/ffmpeg",
].filter((p): p is string => Boolean(p?.trim()));

const CANDIDATE_FFPROBE = [
    process.env.FFPROBE_PATH,
    "ffprobe",
    "/usr/bin/ffprobe",
    "/usr/local/bin/ffprobe",
    "/opt/homebrew/bin/ffprobe",
    "/opt/local/bin/ffprobe",
].filter((p): p is string => Boolean(p?.trim()));

async function run(
    cmd: string[],
    opts?: { inherit?: boolean; allowNonZero?: boolean }
): Promise<{ code: number; stdout: string; stderr: string }> {
    const proc = Bun.spawn(cmd, {
        stdout: opts?.inherit ? "inherit" : "pipe",
        stderr: opts?.inherit ? "inherit" : "pipe",
        stdin: "ignore",
        env: process.env,
    });

    if (opts?.inherit) {
        const code = await proc.exited;
        if (code !== 0 && !opts.allowNonZero) {
            throw new Error(`Command failed (${code}): ${cmd.join(" ")}`);
        }
        return { code, stdout: "", stderr: "" };
    }

    const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    if (code !== 0 && !opts?.allowNonZero) {
        throw new Error(
            `Command failed (${code}): ${cmd.join(" ")}\n${(stderr || stdout).slice(-1500)}`
        );
    }
    return { code, stdout, stderr };
}

/** True if this path/name runs successfully with -version. */
export async function isBinaryAvailable(bin: string): Promise<boolean> {
    try {
        for (const flag of ["-version", "--version"] as const) {
            const { code } = await run([bin, flag], { allowNonZero: true });
            if (code === 0) return true;
        }
        return false;
    } catch {
        return false;
    }
}

/** First candidate that works, or null. */
async function resolveBinary(candidates: string[]): Promise<string | null> {
    for (const c of candidates) {
        if (await isBinaryAvailable(c)) return c;
    }
    return null;
}

export async function hasFfmpegTools(): Promise<boolean> {
    const [ffmpeg, ffprobe] = await Promise.all([
        resolveBinary(CANDIDATE_FFMPEG),
        resolveBinary(CANDIDATE_FFPROBE),
    ]);
    if (ffmpeg) resolvedFfmpeg = ffmpeg;
    if (ffprobe) resolvedFfprobe = ffprobe;
    return Boolean(ffmpeg && ffprobe);
}

async function commandExists(name: string): Promise<boolean> {
    // Prefer absolute shells — bare "sh" can fail depending on spawn PATH
    for (const shell of ["/bin/sh", "/bin/bash", "sh"]) {
        try {
            const { code, stdout } = await run(
                [shell, "-c", `command -v ${JSON.stringify(name)}`],
                { allowNonZero: true }
            );
            if (code === 0 && stdout.trim()) return true;
        } catch {
            /* try next shell */
        }
    }
    // Absolute common paths for package managers
    const abs: Record<string, string[]> = {
        "apt-get": ["/usr/bin/apt-get"],
        apt: ["/usr/bin/apt"],
        dnf: ["/usr/bin/dnf"],
        yum: ["/usr/bin/yum"],
        pacman: ["/usr/bin/pacman"],
        apk: ["/sbin/apk", "/usr/bin/apk"],
        zypper: ["/usr/bin/zypper"],
        brew: ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"],
        sudo: ["/usr/bin/sudo"],
        winget: ["winget"],
        choco: ["choco"],
    };
    for (const p of abs[name] ?? []) {
        try {
            const { code } = await run([p, "--version"], { allowNonZero: true });
            // Some tools use different flags; existence of non-ENOENT is enough
            if (code === 0 || code === 1 || code === 2) return true;
        } catch {
            /* not found */
        }
    }
    return false;
}

async function resolvePmBin(name: string): Promise<string> {
    const abs: Record<string, string[]> = {
        "apt-get": ["/usr/bin/apt-get", "apt-get"],
        dnf: ["/usr/bin/dnf", "dnf"],
        yum: ["/usr/bin/yum", "yum"],
        pacman: ["/usr/bin/pacman", "pacman"],
        apk: ["/sbin/apk", "/usr/bin/apk", "apk"],
        zypper: ["/usr/bin/zypper", "zypper"],
        brew: ["/opt/homebrew/bin/brew", "/usr/local/bin/brew", "brew"],
        sudo: ["/usr/bin/sudo", "sudo"],
        winget: ["winget"],
        choco: ["choco"],
    };
    for (const c of abs[name] ?? [name]) {
        try {
            // Just check spawn is possible by running a harmless probe
            const { code } = await run(
                name === "brew" ? [c, "--version"] : [c, "--help"],
                { allowNonZero: true }
            );
            // If we didn't get ENOENT (caught below), accept it
            void code;
            return c;
        } catch {
            /* next */
        }
    }
    return name;
}

async function isRoot(): Promise<boolean> {
    try {
        const uid = (process as NodeJS.Process & { getuid?: () => number }).getuid?.();
        return uid === 0;
    } catch {
        return false;
    }
}

/**
 * Prefix with sudo -n when not root (Linux package managers).
 * Non-interactive so we don't hang waiting for a password.
 */
async function maybeSudo(cmd: string[]): Promise<string[]> {
    if (await isRoot()) return cmd;
    if (!(await commandExists("sudo"))) return cmd;
    const sudo = await resolvePmBin("sudo");
    return [sudo, "-n", ...cmd];
}

type InstallPlan = {
    label: string;
    steps: string[][];
};

async function detectInstallPlan(): Promise<InstallPlan | null> {
    const platform = process.platform;

    if (platform === "darwin") {
        if (await commandExists("brew")) {
            const brew = await resolvePmBin("brew");
            return { label: "Homebrew", steps: [[brew, "install", "ffmpeg"]] };
        }
        return null;
    }

    if (platform === "linux") {
        if (await commandExists("apt-get")) {
            const apt = await resolvePmBin("apt-get");
            return {
                label: "apt",
                steps: [
                    await maybeSudo([apt, "update", "-y"]),
                    await maybeSudo([apt, "install", "-y", "ffmpeg"]),
                ],
            };
        }
        if (await commandExists("dnf")) {
            const dnf = await resolvePmBin("dnf");
            return {
                label: "dnf",
                steps: [await maybeSudo([dnf, "install", "-y", "ffmpeg"])],
            };
        }
        if (await commandExists("yum")) {
            const yum = await resolvePmBin("yum");
            return {
                label: "yum",
                steps: [await maybeSudo([yum, "install", "-y", "ffmpeg"])],
            };
        }
        if (await commandExists("pacman")) {
            const pacman = await resolvePmBin("pacman");
            return {
                label: "pacman",
                steps: [
                    await maybeSudo([pacman, "-Sy", "--noconfirm", "ffmpeg"]),
                ],
            };
        }
        if (await commandExists("apk")) {
            const apk = await resolvePmBin("apk");
            return {
                label: "apk",
                steps: [
                    await maybeSudo([apk, "add", "--no-cache", "ffmpeg"]),
                ],
            };
        }
        if (await commandExists("zypper")) {
            const zypper = await resolvePmBin("zypper");
            return {
                label: "zypper",
                steps: [
                    await maybeSudo([
                        zypper,
                        "--non-interactive",
                        "install",
                        "ffmpeg",
                    ]),
                ],
            };
        }
    }

    if (platform === "win32") {
        if (await commandExists("winget")) {
            return {
                label: "winget",
                steps: [
                    [
                        "winget",
                        "install",
                        "--id",
                        "Gyan.FFmpeg",
                        "-e",
                        "--accept-source-agreements",
                        "--accept-package-agreements",
                    ],
                ],
            };
        }
        if (await commandExists("choco")) {
            return {
                label: "chocolatey",
                steps: [["choco", "install", "ffmpeg", "-y"]],
            };
        }
    }

    return null;
}

async function installFfmpeg(): Promise<void> {
    const plan = await detectInstallPlan();
    if (!plan) {
        throw new Error(
            `${LOG} ffmpeg/ffprobe missing and no supported package manager found. ` +
                `Install ffmpeg manually (e.g. apt install ffmpeg / brew install ffmpeg) and ensure both ffmpeg and ffprobe are on PATH.`
        );
    }

    console.log(
        `${LOG} ffmpeg/ffprobe not found — installing via ${plan.label}…`
    );
    for (const step of plan.steps) {
        console.log(`${LOG} $ ${step.join(" ")}`);
        await run(step, { inherit: true });
    }
    console.log(`${LOG} Package install finished`);
}

async function warnIfMissingLame(): Promise<void> {
    try {
        const { stdout, stderr, code } = await run(
            [getFfmpegBin(), "-hide_banner", "-encoders"],
            { allowNonZero: true }
        );
        if (code !== 0) return;
        const text = stdout + stderr;
        if (!/libmp3lame/i.test(text)) {
            console.warn(
                `${LOG} ffmpeg is present but libmp3lame encoder was not found — scene audio extraction may fail. Install a full ffmpeg build with LAME support.`
            );
        }
    } catch {
        /* ignore */
    }
}

/**
 * Check for ffmpeg + ffprobe; install the system package if missing.
 * Throws if tools are still unavailable after install (or install is skipped/disabled).
 */
export async function ensureMediaTools(): Promise<void> {
    if (process.env.SKIP_MEDIA_TOOLS_CHECK === "1") {
        console.warn(`${LOG} SKIP_MEDIA_TOOLS_CHECK=1 — skipping ffmpeg check`);
        return;
    }

    if (await hasFfmpegTools()) {
        console.log(
            `${LOG} ready — ffmpeg=${getFfmpegBin()} ffprobe=${getFfprobeBin()}`
        );
        await warnIfMissingLame();
        return;
    }

    console.warn(`${LOG} ffmpeg and/or ffprobe missing from PATH`);

    if (process.env.SKIP_MEDIA_TOOLS_INSTALL === "1") {
        throw new Error(
            `${LOG} ffmpeg/ffprobe required for video/scene workers. ` +
                `Install them or unset SKIP_MEDIA_TOOLS_INSTALL to allow auto-install.`
        );
    }

    try {
        await installFfmpeg();
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(
            `${LOG} Auto-install failed: ${msg}\n` +
                `Install ffmpeg manually so both \`ffmpeg\` and \`ffprobe\` are on PATH, then restart workers.\n` +
                `On Linux you may need: sudo apt-get install -y ffmpeg\n` +
                `On macOS: brew install ffmpeg`
        );
    }

    if (!(await hasFfmpegTools())) {
        throw new Error(
            `${LOG} Install finished but ffmpeg/ffprobe still not found. ` +
                `Fix PATH or set FFMPEG_PATH / FFPROBE_PATH, then restart workers.`
        );
    }

    console.log(
        `${LOG} ready after install — ffmpeg=${getFfmpegBin()} ffprobe=${getFfprobeBin()}`
    );
    await warnIfMissingLame();
}
