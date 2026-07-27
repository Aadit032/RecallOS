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

Before video or scene workers consume a job, they call `ensureMediaTools()` which:

1. Checks that both binaries are available
2. Fails the media worker with an actionable error when either is missing

The all-workers runner keeps non-media workers running if this check fails; only video and scene workers are disabled. Install FFmpeg during VM provisioning (or on the local laptop for development), not at runtime.

| Env | Effect |
|---|---|
| `SKIP_MEDIA_TOOLS_CHECK=1` | Skip the check entirely |
| `ALLOW_MEDIA_TOOLS_INSTALL=1` | Opt in to runtime installation (not recommended) |

For a Linux VM, install it during provisioning with `sudo apt-get install -y ffmpeg`. For local development, verify both binaries with `ffmpeg -version` and `ffprobe -version`.

This project was created using `bun init` in bun v1.3.1. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
