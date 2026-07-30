# RecallOS FastAPI backend

Python port of the Express API (`apps/backend`) with the same `/api/v1/*` surface plus:

- Multi-hop memory agent (`/agent` or `agentMode: true`)
- Long-term memory CRUD (`/api/v1/memories`)
- External connectors + continuous sync (`/api/v1/connectors`)
- Search confidence + preview fields
- Multimodal citation metadata on chat sources

## Setup

```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Load the monorepo root `.env` (or copy it). Apply Prisma migrations first so
tables like `Memory`, `Connector`, and `Session` exist.

## Run

```bash
# from apps/api, PORT defaults to 3000
bun run dev
# or
uvicorn app.main:app --host 0.0.0.0 --port 3000 --reload
```

### Better Auth

Session cookies written by Better Auth (Node) are validated against the
`Session` table. For Google OAuth:

1. Run the Node backend auth handler on another port, e.g. `PORT=3002 bun run --filter backend dev`
2. Set `AUTH_PROXY_URL=http://localhost:3002` so FastAPI proxies `/api/auth/*`
3. Keep `BETTER_AUTH_URL=http://localhost:3000` (browser hits FastAPI, which proxies)

Or run the original Express backend alone if you only need Node.

## Health

`GET /health` → `{ "ok": true, "backend": "fastapi" }`
