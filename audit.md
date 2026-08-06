# RecallOS Security Audit

**Date:** 2026-08-06  
**Scope:** Full monorepo (`apps/backend`, `apps/web`, `apps/workers`, `packages/*`)  
**Auditor perspective:** Senior application security engineer  
**Status:** Findings documented below; confirmed issues fixed in-tree (see [Remediation status](#remediation-status))

---

## Executive summary

RecallOS is a multi-tenant personal knowledge OS: Express API + Better Auth sessions, Next.js UI, Bun modality workers, Postgres (Prisma), Redis streams, MinIO, and Qdrant.

**Strengths already present before the audit:**

- Prisma for data access (no string-built SQL)
- Session middleware on `/api/v1/*` routes
- Ownership checks (`userId`) on chats, projects, documents, memories, connectors
- Hybrid retrieval filtered by owned `documentId`s (with post-filter on payload)
- FFmpeg/ffprobe invoked via argv arrays (not shell strings)
- Env files gitignored; secrets not committed

**Critical gaps found and fixed:**

1. Upload confirm IDOR / unscoped object keys  
2. SSRF via connectors (URL/RSS/GitHub download)  
3. GitHub connector tokens returned to the browser  
4. Weak prompt-injection hygiene on LLM system prompts  
5. Internal error details leaked to API clients  

**Not in scope of this repo:** Docker/Kubernetes manifests (none present). Residual risks are listed at the end.

---

## Attack surface map

| Surface | Location | Risk themes |
|---------|----------|-------------|
| Auth / sessions | `apps/backend/auth.ts`, `middleware.ts` | Cookie security, secret strength, CSRF (Better Auth) |
| Upload / MinIO | `uploadRouter.ts`, web upload clients | IDOR, MIME/size, path traversal |
| Download | `downloadRouter.ts` | Authz on keys, delete cascade |
| Chat / RAG / agents | `chatRouter.ts`, `chatService.ts`, agents | Prompt injection, data exfil via model |
| Connectors | `connectorService.ts`, `connectorRouter.ts` | SSRF, token storage/leak |
| Search | `searchRouter.ts`, `hybridRetrieve.ts` | Tenant isolation (Qdrant) |
| Workers | `apps/workers/**` | RCE via media tools, temp files |
| Frontend | `markdown-content.tsx`, API clients | XSS via model markdown |
| Config / secrets | `.env*`, package env files | Leakage via git / logs |
| Infra | (none in repo) | Docker/K8s privilege |

---

## Findings

Severity: **Critical** · **High** · **Medium** · **Low** · **Info**

---

### F-01 — Upload confirm IDOR / unscoped object keys

| | |
|---|---|
| **Severity** | Critical |
| **CWE** | CWE-639 (Authorization Bypass Through User-Controlled Key), CWE-22 |
| **Status** | **Fixed** |
| **Location** | `apps/backend/routers/uploadRouter.ts` (pre-fix) |

**Description**

1. Presigned PUT keys were `/{modality}/{filename}-{uuid}` with **no user prefix**.  
2. `POST /confirm` accepted any `key` that existed in the bucket.  
3. On Prisma unique violation `P2002` (duplicate `ObjectKey`), the handler loaded the existing document **without checking `userId`** and returned its `documentId` to the caller.

**Impact**

- A user who learns or guesses another user’s object key can attach that object to their account or observe document IDs.  
- Cross-tenant document claim / metadata disclosure.

**Remediation applied**

- Keys: `uploads/{userId}/{modality}/{uuid}-{safeFileName}` via `buildUploadObjectKey`.  
- Confirm requires `assertOwnedUploadKey(userId, key)`.  
- Duplicate key path only succeeds if the existing row is owned by the requester; otherwise `409`.  
- FAILED status updates only touch the caller’s document.

---

### F-02 — SSRF via URL / RSS / connector fetches

| | |
|---|---|
| **Severity** | Critical |
| **CWE** | CWE-918 |
| **Status** | **Fixed** |
| **Location** | `apps/backend/services/connectorService.ts` (`fetchUrlText`, `syncRss`, GitHub `download_url`) |

**Description**

Connector sync called `fetch(userSuppliedUrl)` (and RSS item links) with no validation of scheme, host, or resolved IP. An authenticated user could force the server to request:

- `http://127.0.0.1`, `http://localhost`, RFC1918 addresses  
- Cloud metadata (`169.254.169.254`)  
- Internal services reachable from the backend network  

**Impact**

- Internal network reconnaissance  
- Metadata credential theft (cloud environments)  
- Potential pivot to admin interfaces / Redis / Postgres if exposed on localhost

**Remediation applied** (`apps/backend/security/ssrf.ts`)

- Allow only `http:` / `https:`  
- Reject userinfo in URLs, blocked hostnames (localhost, `*.local`, metadata hosts)  
- Block private / link-local / CGNAT / multicast IPv4 and IPv6  
- DNS resolution check before fetch  
- Manual redirect handling with re-validation; cap redirect chain  
- Response body size cap (2 MiB)  
- Config validation at connector create time

---

### F-03 — GitHub path / repo injection

| | |
|---|---|
| **Severity** | High |
| **CWE** | CWE-22, CWE-74 |
| **Status** | **Fixed** |
| **Location** | `syncGithub` in `connectorService.ts` |

**Description**

`repo` and `path` were interpolated into GitHub API URLs with insufficient validation (`owner/name` shape, `..` segments, encoding). `download_url` from the API was fetched without host allowlisting.

**Impact**

- Unexpected API path construction  
- Open fetch to non-GitHub hosts if API were ever tricked or proxied  
- Token sent to untrusted download hosts

**Remediation applied**

- `validateGithubRepo` — strict `owner/name`  
- `validateGithubPath` — no `..`, segment encoding  
- Branch name allowlist pattern  
- Download only from `*.githubusercontent.com` / related GitHub object hosts  
- Safe fetch path for downloads

---

### F-04 — Connector secrets returned to the client

| | |
|---|---|
| **Severity** | High |
| **CWE** | CWE-200, CWE-312 |
| **Status** | **Fixed** |
| **Location** | `listConnectors`, create/update responses |

**Description**

Connector `config` JSON (including optional GitHub `token`) was returned verbatim to the SPA on list/create/patch.

**Impact**

- Token exposure via XSS, shared screen, browser extensions, client logs  
- Persistent secret in browser memory / React state

**Remediation applied**

- `redactConnectorConfig`: token → `[redacted]`, `hasToken: boolean`  
- Applied on list, create, and status update responses  
- Create-time sanitization of stored config (`sanitizeConnectorConfigForStorage`)

**Residual:** Tokens remain at rest in Postgres JSON. Prefer envelope encryption / secret manager for production.

---

### F-05 — Prompt injection into LLM system / agent prompts

| | |
|---|---|
| **Severity** | High |
| **CWE** | CWE-77 (instruction injection analog), OWASP LLM01 |
| **Status** | **Mitigated** (defense-in-depth; not fully eliminable) |
| **Location** | `chatService.ts`, `memoryService.ts`, `webagent.ts`, `memoryAgent.ts` |

**Description**

Untrusted inputs were concatenated into model prompts without separation:

- Retrieved document chunks  
- User / project system prompts  
- Web search result bodies  
- Long-term memories extracted from chat  
- User-Agent strings  
- Chat history for summarization  

A malicious document or user message could attempt to override system policy (“ignore previous instructions”, exfiltrate other context, etc.).

**Impact**

- Policy bypass / unsafe answers  
- Cross-document or memory-influenced manipulation  
- Indirect injection via connectors or uploaded PDFs

**Remediation applied** (`apps/backend/security/promptGuard.ts`)

- Fence untrusted content: `<<<UNTRUSTED_LABEL>>>` … `<<<END_UNTRUSTED_LABEL>>>`  
- Explicit untrusted-data policy in system/agent prompts  
- Applied to RAG chat, web agent, memory agent, memory extraction, summaries  
- Strip fence markers from content before re-injection where applicable  

**Residual:** Model compliance is probabilistic. For high-sensitivity deployments, add tool allowlists, output validators, and separate retrieval citations from instruction channels.

---

### F-06 — Insecure file uploads (MIME / size / path)

| | |
|---|---|
| **Severity** | High |
| **CWE** | CWE-434, CWE-400 |
| **Status** | **Fixed** |
| **Location** | `uploadRouter.ts`, upload clients |

**Description**

- Any `contentType` accepted  
- No max object size on confirm (beyond implicit infrastructure)  
- Filename sanitization partial; keys not user-scoped (see F-01)  
- Empty browser `file.type` could produce odd MIME handling  

**Impact**

- Malware storage / polyglot files  
- Resource exhaustion (very large objects)  
- Worker pipeline abuse (expensive parse/embed jobs)

**Remediation applied** (`uploadPolicy.ts`)

- MIME allowlist (PDF, text, common images/audio/video)  
- `MAX_UPLOAD_BYTES` (default 100 MiB; env-configurable)  
- Size checked on confirm against MinIO `ContentLength`  
- Optional `ContentLength` on presigned PUT when client sends `size`  
- Key modality segment must match claimed MIME  
- Frontend sends size + guessed content type when `File.type` is empty  

---

### F-07 — Error / exception leakage to clients

| | |
|---|---|
| **Severity** | Medium–High |
| **CWE** | CWE-209 |
| **Status** | **Fixed** |
| **Location** | Multiple routers (`upload`, `download`, `chat`, `search`, `projects`, `memories`, `connectors`) |

**Description**

Patterns such as:

```ts
res.status(500).json({ message: "…" + e });
res.status(500).json({ message: "…", error: e instanceof Error ? e.message : e });
```

and SSE payloads embedding `err.message` exposed internal failures (Prisma, network, stack-ish strings).

**Impact**

- Easier recon of stack, DB, and infrastructure  
- Aid for further exploitation  

**Remediation applied**

- Generic client-facing messages  
- Server-side `console.error` only  
- Safe helper `sendSafeError` / `clientErrorMessage` for intentional validation errors  
- Chat SSE errors genericized  

---

### F-08 — Missing rate limiting / body size limits

| | |
|---|---|
| **Severity** | Medium |
| **CWE** | CWE-770, CWE-400 |
| **Status** | **Fixed** (single-instance) |
| **Location** | `apps/backend/index.ts` |

**Description**

No request rate limits; `express.json()` unbounded default; expensive endpoints (chat, search, connectors, upload) callable at high frequency per session.

**Impact**

- Cost amplification (LLM, embeddings, Exa, LlamaParse)  
- Memory DoS via large JSON bodies  

**Remediation applied**

- `express.json({ limit: "1mb" })`  
- In-process rate limiters: chat (30/min), upload (40/min), search (60/min), connectors (20/min), general (120/min)  

**Residual:** Limits are per process; multi-instance needs Redis or edge rate limiting.

---

### F-09 — Auth secret and cookie hardening

| | |
|---|---|
| **Severity** | Medium |
| **CWE** | CWE-798, CWE-614 |
| **Status** | **Fixed** |
| **Location** | `auth.ts`, `index.ts` |

**Description**

- Weak/missing `BETTER_AUTH_SECRET` could allow session forgery  
- Cookie security attributes not explicitly set for production  

**Remediation applied**

- Process exit if `BETTER_AUTH_SECRET` missing or &lt; 32 characters  
- `useSecureCookies` + `httpOnly` / `sameSite: "lax"` / `secure` when not localhost  

**Note:** Better Auth origin checks + trustedOrigins remain the primary CSRF control for cookie sessions.

---

### F-10 — Markdown XSS / unsafe links in chat UI

| | |
|---|---|
| **Severity** | Medium |
| **CWE** | CWE-79 |
| **Status** | **Fixed** |
| **Location** | `apps/web/components/chat-app/markdown-content.tsx` |

**Description**

`react-markdown` without raw HTML is relatively safe, but arbitrary `href` values (e.g. `javascript:`) and markdown images could enable script navigation or tracking/SSRF-style loads via the browser.

**Remediation applied**

- Allow only `http(s):`, same-origin path `/`, and `#` fragments  
- Unsafe links rendered as plain text  
- Images from model output dropped  
- `rel="noopener noreferrer nofollow"`  

---

### F-11 — Missing security headers

| | |
|---|---|
| **Severity** | Low–Medium |
| **CWE** | CWE-693 |
| **Status** | **Fixed** |
| **Location** | `apps/backend/index.ts`, `apps/web/next.config.js` |

**Remediation applied**

- API: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`; `x-powered-by` disabled  
- Next.js: same baseline headers on all routes  

**Residual:** Full CSP not configured (would need careful tuning for KaTeX, Next assets, API origin).

---

### F-12 — Secret / env file hygiene

| | |
|---|---|
| **Severity** | Medium (process) / Info (repo state) |
| **CWE** | CWE-538 |
| **Status** | **Hardened** |
| **Location** | `.gitignore`, package gitignores |

**Description**

Multiple package-level `.env` files exist for local dev. Root and most packages ignored `.env`; `packages/langfuse` lacked its own gitignore (root still covered nested `.env` in practice). Risk is accidental commit or copy into images.

**Remediation applied**

- Root `.gitignore`: `**/.env`, `**/.env.*`, with `!.env.example` exceptions  
- `packages/langfuse/.gitignore` added  

**Verified:** `.env` files are untracked (`git check-ignore`).

---

### F-13 — Overly permissive modality / query inputs

| | |
|---|---|
| **Severity** | Low |
| **CWE** | CWE-20 |
| **Status** | **Fixed** |
| **Location** | `apps/backend/types.ts` |

**Description**

`modality` on chat/search accepted free-form strings; download list cursor was unvalidated.

**Remediation applied**

- `modality` enum: `pdf | image | audio | video`  
- Search `offset` capped  
- Download list cursor must be UUID-shaped  

---

### F-14 — SQL injection

| | |
|---|---|
| **Severity** | Info (not vulnerable) |
| **Status** | **No issue** |

**Assessment**

No `$queryRaw` / `$executeRaw` / dynamic SQL in application code. Migrations are static. Prisma query builders are parameterized. Hybrid search uses Qdrant client APIs with structured filters.

---

### F-15 — RCE / command injection

| | |
|---|---|
| **Severity** | Info (not vulnerable under current design) |
| **Status** | **No issue** |

**Assessment**

- `Bun.spawn(cmd, …)` with argv arrays in `ffmpeg.ts` / `ensureMediaTools.ts`  
- No `eval`, `new Function`, or shell-interpolated user input  
- Media paths are worker temp dirs + object keys from DB  

**Caveat:** Malicious media files can still stress ffmpeg (resource exhaustion); size limits and worker isolation help.

---

### F-16 — AuthZ / RBAC model

| | |
|---|---|
| **Severity** | Info / design |
| **Status** | **Acceptable for product model** |

**Assessment**

There is no multi-role RBAC (admin/member). Authorization is **owner-scoped**: every resource query filters by `req.userId` from the session. Chats, projects, documents, memories, and connectors consistently check ownership before mutate/delete.

**Gaps closed by this audit:** F-01 (upload key claim) was the main IDOR-style hole.

**Future:** If teams/shared projects are added, introduce explicit ACLs and re-audit all `findFirst` / `update` paths.

---

### F-17 — Docker / Kubernetes security

| | |
|---|---|
| **Severity** | Info (N/A) |
| **Status** | **No manifests in repository** |

**Assessment**

No `Dockerfile`, `docker-compose`, Helm charts, or K8s YAML in the repo. Local README uses default Postgres/MinIO credentials for **developer convenience only**.

**Recommendations when infra is added:**

| Control | Guidance |
|---------|----------|
| User | Run containers as non-root (`USER` / `runAsNonRoot`) |
| Capabilities | Drop `ALL`; add only required |
| Filesystem | Prefer read-only root FS; writable emptyDir for temp |
| Secrets | Never bake `.env` into images; use sealed secrets / external secrets |
| Network | NetworkPolicies; no public Redis/Postgres/MinIO |
| Privileged | No `privileged: true`, no hostNetwork by default |
| Images | Pin digests; scan for CVEs |
| Defaults | Change MinIO/Postgres passwords from README samples |

---

### F-18 — Tenant isolation in vector search

| | |
|---|---|
| **Severity** | Info (mitigated) |
| **Status** | **Acceptable** |
| **Location** | `hybridRetrieve.ts` |

**Assessment**

Retrieval:

1. Loads owned document IDs from Postgres  
2. Qdrant filter `documentId match any owned`  
3. Post-filters results against owned set and optional `payload.userId`  

Defense in depth is good. Ensure **all embed paths** write correct `documentId` / `userId` payloads (workers) so filters cannot be bypassed by polluted points.

---

### F-19 — Deprecation surface (legacy auth schemas)

| | |
|---|---|
| **Severity** | Low / Info |
| **Status** | **Informational** |
| **Location** | `types.ts` signup/signin zod schemas; `authRouter.ts` deprecated |

Legacy username/password JWT auth is removed (`authRouter` returns deprecation message). Weak password schemas in types (`min(3)`) are unused dead code for the live OAuth path—safe to delete in a cleanup PR to avoid confusion.

---

## Remediation status

| ID | Title | Status |
|----|-------|--------|
| F-01 | Upload IDOR / unscoped keys | Fixed |
| F-02 | Connector SSRF | Fixed |
| F-03 | GitHub path injection | Fixed |
| F-04 | Token leak in connector API | Fixed |
| F-05 | Prompt injection | Mitigated |
| F-06 | Upload MIME/size policy | Fixed |
| F-07 | Error leakage | Fixed |
| F-08 | Rate limits / body size | Fixed (single node) |
| F-09 | Auth secret / cookies | Fixed |
| F-10 | Markdown XSS / links | Fixed |
| F-11 | Security headers | Fixed |
| F-12 | Env gitignore | Hardened |
| F-13 | Input validation | Fixed |
| F-14 | SQL injection | N/A (safe) |
| F-15 | RCE | N/A (safe) |
| F-16 | RBAC / ownership | Acceptable + IDOR fixed |
| F-17 | Docker/K8s | N/A (no manifests) |
| F-18 | Qdrant tenancy | Acceptable |
| F-19 | Dead legacy auth types | Info |

### Code added / primary touchpoints

```
apps/backend/security/
  ssrf.ts
  uploadPolicy.ts
  promptGuard.ts
  rateLimit.ts
  httpErrors.ts
```

Also updated: upload/download/chat/connector routers, `connectorService`, `chatService`, `memoryService`, agents, `auth.ts`, `index.ts`, web markdown + upload clients, `next.config.js`, `.gitignore`, `.env.example`.

---

## Residual risks & recommendations

1. **LLM prompt injection** cannot be fully eliminated; monitor Langfuse traces for jailbreak patterns; consider output filtering for secret-shaped strings.  
2. **Scale rate limiting** with Redis or API gateway for multi-replica deploys.  
3. **Encrypt connector tokens at rest** (KMS / libsodium secretbox with app key).  
4. **CSP** on the Next app when third-party script policy is settled.  
5. **Presigned URL TTL** stays short (5 minutes); keep MinIO buckets private.  
6. **Worker isolation:** separate network from DB if possible; resource limits on ffmpeg jobs.  
7. **Dependency scanning:** add `bun audit` / OSV in CI.  
8. **When adding Docker/K8s:** follow F-17 checklist before production.  
9. **No automated tests** in the codebase—security regressions need regression tests for ownership and SSRF helpers.

---

## Verification notes

Security utility smoke tests (local):

- SSRF rejects `127.0.0.1`, `localhost`, `169.254.169.254`, `10.0.0.5`, `file:`, credentialed URLs  
- SSRF accepts `https://example.com/path`  
- GitHub repo/path validation rejects `../`  
- Upload key ownership enforces `uploads/{userId}/…`  
- MIME allowlist rejects non-allowlisted types  
- Changed backend modules bundle under Bun (`--target=bun`)  

Backend will refuse to start without a strong secret:

```bash
export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
bun run --filter backend dev
```

---

## Appendix A — Checklist used

- [x] SQL injection  
- [x] Prompt injection  
- [x] SSRF  
- [x] RCE / command injection  
- [x] Insecure file uploads  
- [x] Auth bugs  
- [x] RBAC / ownership  
- [x] Secret leaks  
- [x] Docker privilege (N/A)  
- [x] Kubernetes security (N/A)  

## Appendix B — Key env vars (security-relevant)

| Variable | Role |
|----------|------|
| `BETTER_AUTH_SECRET` | Session signing (≥32 chars required) |
| `BETTER_AUTH_URL` | Auth base URL / cookie secure inference |
| `FRONTEND_URL` | CORS + trustedOrigins |
| `MAX_UPLOAD_BYTES` | Upload size cap |
| `AWS_BUCKET_NAME` / MinIO credentials | Object storage |
| `OPENROUTER_API_KEY`, `EXA_API_KEY`, `LLAMA_CLOUD_API_KEY`, `HF_TOKEN` | External AI providers |
| `DATABASE_URL`, `REDIS_URL` | Data plane |

Never commit real values; use `.env.example` as the template only.

---

*End of audit report.*
