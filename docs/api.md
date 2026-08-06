# API reference

Base URLs (local defaults):

| Service | Base |
|---------|------|
| API | `http://localhost:3000` |
| Auth (Better Auth) | `http://localhost:3000/api/auth` |
| Application API | `http://localhost:3000/api/v1` |
| Web | `http://localhost:3001` |

All `/api/v1/*` routes require a **Better Auth session cookie**. Send requests with `credentials: "include"` (Axios: `withCredentials: true`).

CORS allows only `FRONTEND_URL` (default `http://localhost:3001`) with credentials.

---

## Authentication

### Session model

- Provider: **Google OAuth** via Better Auth
- Cookie: HttpOnly session (secure in production / non-localhost)
- Session lifetime: 7 days, sliding renewal (updateAge 1 day)
- Middleware sets `req.userId` from `session.user.id`

### Better Auth routes

Mounted at `/api/auth/*` (see [Better Auth docs](https://www.better-auth.com/docs)). Typical flows:

| Action | Client usage |
|--------|----------------|
| Sign in with Google | `authClient.signIn.social({ provider: "google" })` |
| Session | `authClient.useSession()` / `getSession()` |
| Sign out | `authClient.signOut()` |

Configure:

- `BETTER_AUTH_URL` — API public origin  
- `BETTER_AUTH_SECRET` — ≥32 characters (required)  
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`  
- `FRONTEND_URL` — trusted origin + CORS  

### Deprecated

- Username/password JWT under legacy paths is **removed**. Responses indicate use Google OAuth via `/api/auth`.

### Unauthenticated response

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{"message":"Unauthorized"}
```

### Rate limits

Per authenticated user (in-process, 60s window):

| Scope | Max requests / minute |
|-------|----------------------|
| Chat | 30 |
| Upload | 40 |
| Search | 60 |
| Connectors | 20 |
| Other v1 | 120 |

Exceeded → `429` `{ "message": "Too many requests. Please try again later." }`

Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

---

## Common conventions

- JSON bodies, `Content-Type: application/json`
- IDs are UUIDs
- Errors: `{ "message": string }` (no stack traces)
- Validation failures: `422` with Zod details where used
- Timestamps: ISO-8601 strings from Prisma/JSON

---

## Upload

Prefix: `/api/v1/upload`

### `POST /post-file-url`

Request a presigned MinIO PUT URL.

**Body**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `fileName` | string | yes | max 255 |
| `contentType` | string | yes | allowlisted MIME |
| `size` | number | no | bytes; if set, bound into signature |

**Allowed MIME (examples):** `application/pdf`, `text/plain`, `text/markdown`, `image/png`, `image/jpeg`, `image/webp`, `audio/mpeg`, `audio/wav`, `video/mp4`, `video/webm`, …

**Response `200`**

```json
{
  "presignedUrl": "https://...",
  "key": "uploads/{userId}/pdf/{uuid}-report.pdf",
  "maxBytes": 104857600,
  "contentType": "application/pdf"
}
```

### `POST /confirm`

After successful PUT to MinIO, create the DB row and enqueue processing.

**Body**

| Field | Type | Required |
|-------|------|----------|
| `fileName` | string | yes |
| `key` | string | yes (must be owned path) |
| `size` | number | yes (must match HeadObject) |
| `contentType` | string | no |
| `tags` | string[] | no (max 20, each ≤40 chars) |

**Response `200`**

```json
{
  "message": "Server confirmed the upload!!",
  "documentId": "uuid"
}
```

**Errors:** `400` invalid input, `403` key not owned / size mismatch, `409` key conflict, `413` too large, `500` queue/DB failure.

---

## Download / documents

Prefix: `/api/v1/download`

### `POST /get-download-url`

**Body:** `{ "key": "uploads/..." }`  
**Response `200`:** `{ "presignedUrl": "..." }` (5 min)  
**Errors:** `400` missing key, `403` not owner

### `GET /list`

Query: `?limit=10&cursor=<documentUuid>`

- `limit` default 10, max 50  
- `cursor` optional UUID  

**Response `200`**

```json
{
  "documents": [
    {
      "id": "uuid",
      "title": "report.pdf",
      "status": "READY",
      "ObjectKey": "uploads/...",
      "modality": "pdf",
      "tags": ["work"],
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "nextCursor": "uuid-or-null"
}
```

### `DELETE /:id`

Deletes stream messages (best-effort), MinIO object, Qdrant points, and DB row.

**Response `200`:** `{ "message": "Document deleted" }`  
**Errors:** `404` not found / not owned

### Document statuses

`UPLOADED` · `QUEUED` · `PARSING` · `PROCESSING` · `PARSED` · `EMBEDDING` · `INDEXED` · `COMPLETED` · `READY` · `FAILED` · `RETRYING`

---

## Search

Prefix: `/api/v1/search`

### `POST /`

Natural-language **document** search (aggregated from chunks).

**Body**

```json
{
  "query": "string",
  "limit": 10,
  "offset": 0,
  "modality": "pdf"
}
```

| Field | Constraints |
|-------|-------------|
| `query` | 1–2000 chars |
| `limit` | 1–50 optional |
| `offset` | 0–500 optional |
| `modality` | `pdf` \| `image` \| `audio` \| `video` optional |

**Response `200`**

```json
{
  "documents": [
    {
      "id": "uuid",
      "title": "...",
      "ObjectKey": "...",
      "modality": "pdf",
      "mimeType": "application/pdf",
      "tags": [],
      "status": "READY",
      "createdAt": "...",
      "score": 0.42,
      "confidence": 0.9,
      "snippet": "...",
      "preview": "...",
      "chunkId": "..."
    }
  ],
  "offset": 0,
  "limit": 10,
  "hasMore": false,
  "nextOffset": null,
  "totalMatched": 3
}
```

---

## Chat

Prefix: `/api/v1/chat`

### `GET /`

List chats (paginated, no messages).

Query: `?limit=20&cursor=<chatUuid>`  
`limit` 1–50.

**Response `200`**

```json
{
  "chats": [
    {
      "id": "uuid",
      "title": "New chat",
      "pinned": false,
      "projectId": null,
      "projectName": null,
      "messageCount": 4,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "nextCursor": null,
  "hasMore": false
}
```

### `GET /:id`

Full chat + messages (ordered ascending).

**Response `200`:** `{ "chat": { ..., "messages": [...], "project": {...} } }`  
**404** if not found / not owned.

### `PATCH /:id`

**Body** (all optional):

```json
{
  "title": "string",
  "pinned": true,
  "projectId": "uuid-or-null"
}
```

If `projectId` set, project must belong to the user.

### `DELETE /:id`

Deletes chat and messages (cascade).

### `POST /message`

Send a user message; streams assistant reply via **SSE**.

**Body**

```json
{
  "message": "string (1–8000)",
  "chatId": "uuid optional",
  "userAgent": "string optional max 1000",
  "modality": "pdf|image|audio|video optional",
  "agentMode": false
}
```

**Modes**

| Condition | Mode |
|-----------|------|
| Message starts with `/web` | Web research agent |
| Message starts with `/agent` or `agentMode: true` | Multi-hop library agent |
| Otherwise | Hybrid RAG chat |

Cannot combine `/web` and `/agent`.

**Response:** `Content-Type: text/event-stream`

#### SSE event types

Each event: `data: {json}\n\n`

| `type` | Purpose |
|--------|---------|
| `meta` | Session meta, sources, user message |
| `status` | Human-readable progress |
| `agent_step` | Web/agent graph step details |
| `delta` | Assistant text chunk |
| `done` | Final messages + sources |
| `error` | Failure (stream ends) |

**Example meta**

```json
{
  "type": "meta",
  "chatId": "uuid",
  "title": "…",
  "isNewSession": true,
  "mode": "memory",
  "userMessage": { "id": "…", "role": "user", "content": "…", "createdAt": "…" },
  "sources": [
    {
      "rank": 1,
      "id": "point-or-chunk-id",
      "score": 0.9,
      "text": "snippet…",
      "documentId": "uuid",
      "title": "doc.pdf",
      "modality": "pdf",
      "page": 3,
      "objectKey": "uploads/…"
    }
  ]
}
```

**Example delta / done**

```json
{ "type": "delta", "content": "Hello" }
```

```json
{
  "type": "done",
  "chatId": "uuid",
  "title": "…",
  "isNewSession": false,
  "mode": "memory",
  "userMessage": { },
  "assistantMessage": { "id": "…", "role": "assistant", "content": "…", "createdAt": "…" },
  "sources": []
}
```

**Web sources** may include `url` and `title` instead of document metadata.

---

## Projects

Prefix: `/api/v1/projects`

### `GET /`

```json
{
  "projects": [
    {
      "id": "uuid",
      "name": "Work",
      "systemPrompt": "…",
      "createdAt": "…",
      "updatedAt": "…",
      "chatCount": 2
    }
  ]
}
```

### `POST /`

**Body:** `{ "name": "1–100 chars", "systemPrompt": "optional max 8000" }`  
**Response `201`:** `{ "project": {…} }`

### `PATCH /:id`

**Body:** optional `name`, `systemPrompt`

### `DELETE /:id`

Chats keep messages; `projectId` set null (`onDelete: SetNull`).

---

## Memories

Prefix: `/api/v1/memories`

### `GET /`

Returns long-term memories for the user (importance-ordered).

### `POST /`

**Body:**

```json
{
  "fact": "string 3–500 chars",
  "importance": 5
}
```

`importance` optional int 1–10 (default 5).  
**Response `201`:** `{ "memory": {…} }`

### `DELETE /:id`

**404** if not found / not owned.

---

## Connectors

Prefix: `/api/v1/connectors`

### Types

| `type` | Config highlights |
|--------|-------------------|
| `url` | `{ "url": "https://…" }` |
| `notion` | same as url (public page) |
| `rss` | `{ "feedUrl": "https://…" }` |
| `github` | `{ "repo": "owner/name", "branch?", "path?", "token?", "maxItems?" }` |

`syncInterval`: minutes, 5–1440 (default 30).

**Security:** URLs validated against SSRF; GitHub tokens redacted on read (`token: "[redacted]"`, `hasToken: true`).

### `GET /`

List connectors + last 3 jobs. Config secrets redacted.

### `POST /`

Create + kick off first sync asynchronously.

**Body:**

```json
{
  "type": "github",
  "name": "My repo",
  "config": { "repo": "acme/docs", "branch": "main" },
  "syncInterval": 30
}
```

**Response `201`:** `{ "connector": {…} }`  
**400** on invalid URL/repo/token format.

### `PATCH /:id`

**Body:** `{ "status": "ACTIVE" | "PAUSED" }` (supported field)

### `POST /:id/sync`

Run sync immediately (owner only).

**Response `200`:** `{ "documentsCreated": number, "error"?: string }`

### `DELETE /:id`

---

## Error catalog

| Status | Typical cause |
|--------|----------------|
| 400 | Bad request / validation (MIME, size, URL) |
| 401 | Missing/invalid session |
| 403 | Forbidden (object key, ownership) |
| 404 | Resource not found for this user |
| 409 | Conflict (duplicate object key) |
| 413 | Payload / object too large |
| 422 | Zod validation failure |
| 429 | Rate limited |
| 500 | Internal error (generic message) |

---

## Client integration sketch

```ts
// credentials required for session cookies
await fetch("http://localhost:3000/api/v1/chat/", {
  credentials: "include",
});

// SSE chat
const res = await fetch("http://localhost:3000/api/v1/chat/message", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: "Summarize my latest PDF" }),
});
const reader = res.body!.getReader();
// parse lines starting with "data: "
```

Web app clients live under `apps/web/lib/api/`.

---

## OpenAPI

There is no generated OpenAPI file yet. This document is the source of truth; a future improvement is to export Zod schemas to OpenAPI 3.
