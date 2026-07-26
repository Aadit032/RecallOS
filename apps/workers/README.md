# workers

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

## Media tools (ffmpeg)

Video and scene workers require **`ffmpeg`** and **`ffprobe`** on `PATH`.

On startup, workers call `ensureMediaTools()` which:

1. Checks that both binaries are available
2. If missing, installs the platform `ffmpeg` package via the local package manager (`apt`, `dnf`, `yum`, `pacman`, `apk`, `zypper`, `brew`, `winget`, or `choco`)
3. Fails the process if tools are still unavailable

| Env | Effect |
|---|---|
| `SKIP_MEDIA_TOOLS_CHECK=1` | Skip the check entirely |
| `SKIP_MEDIA_TOOLS_INSTALL=1` | Check only; never auto-install |

On Linux, install uses `sudo -n` when not running as root (needs passwordless sudo or run as root).

This project was created using `bun init` in bun v1.3.1. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
