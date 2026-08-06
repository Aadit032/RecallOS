# Sequence diagrams

End-to-end interaction flows for RecallOS. Companion to [Architecture](./architecture.md) and [API](./api.md).

---

## 1. Google OAuth sign-in

```mermaid
sequenceDiagram
  actor User
  participant Web as Next.js web
  participant API as Express / Better Auth
  participant Google as Google OAuth
  participant PG as Postgres

  User->>Web: Open /signin
  User->>Web: Click Sign in with Google
  Web->>API: GET /api/auth/sign-in/social?provider=google
  API->>Google: Redirect OAuth consent
  User->>Google: Approve
  Google->>API: OAuth callback
  API->>PG: Upsert User + Account + Session
  API-->>Web: Set-Cookie session (HttpOnly)
  Web-->>User: Redirect dashboard / chat
```

---

## 2. Authenticated API request

```mermaid
sequenceDiagram
  participant Web as Browser
  participant API as Express
  participant Auth as Better Auth
  participant Router as Route handler
  participant PG as Postgres

  Web->>API: GET /api/v1/... (Cookie)
  API->>Auth: getSession(headers)
  alt No session
    Auth-->>API: null
    API-->>Web: 401 Unauthorized
  else Valid session
    Auth-->>API: { user.id }
    API->>API: req.userId = user.id
    API->>Router: next()
    Router->>PG: query WHERE userId = ...
    PG-->>Router: rows
    Router-->>Web: 200 JSON
  end
```

---

## 3. Document upload (presigned MinIO)

```mermaid
sequenceDiagram
  actor User
  participant Web as Web client
  participant API as Upload API
  participant MinIO as MinIO
  participant PG as Postgres
  participant Redis as Redis Streams

  User->>Web: Select file + tags
  Web->>API: POST /api/v1/upload/post-file-url<br/>{fileName, contentType, size}
  API->>API: MIME allowlist, build user-scoped key
  API-->>Web: { presignedUrl, key, contentType, maxBytes }
  Web->>MinIO: PUT presignedUrl (file bytes)
  MinIO-->>Web: 200
  Web->>API: POST /api/v1/upload/confirm<br/>{fileName, key, size, contentType, tags}
  API->>API: assertOwnedUploadKey(userId, key)
  API->>MinIO: HeadObject(key)
  MinIO-->>API: ContentLength
  alt Size mismatch or invalid
    API-->>Web: 403 / 400
  else OK
    API->>PG: INSERT Document UPLOADED
    API->>Redis: XADD files_stream {docId}
    API->>PG: UPDATE streamMessageId
    API-->>Web: { documentId }
  end
```

---

## 4. Ingestion: dispatcher → parser → embedder

```mermaid
sequenceDiagram
  participant Redis as Redis Streams
  participant Disp as Dispatcher
  participant PG as Postgres
  participant Parser as Modality worker
  participant MinIO as MinIO
  participant Llama as LlamaCloud / Vision / STT
  participant Emb as Embedder
  participant Qdrant as Qdrant

  Redis->>Disp: XREADGROUP files_stream {docId}
  Disp->>PG: Load Document mimeType
  Disp->>PG: status = QUEUED, set modality
  Disp->>Redis: XADD pdf|image|audio|video_stream {docId}
  Disp->>Redis: XACK files_stream

  Redis->>Parser: XREADGROUP modality stream
  Parser->>PG: status = PARSING
  Parser->>MinIO: GetObject(ObjectKey)
  Parser->>Llama: Parse / caption / transcribe
  Parser->>PG: Create ParsedChunkSet + ParsedChunks
  Parser->>PG: status = PARSED
  Parser->>Redis: XADD embed_stream {chunkSetId}
  Parser->>Redis: XACK modality stream

  Redis->>Emb: XREADGROUP embed_stream
  Emb->>PG: Load chunks
  Emb->>Emb: Dense BGE + sparse SPLADE
  Emb->>Qdrant: Upsert points (documentId, userId, text, meta)
  Emb->>PG: Document status = READY
  Emb->>Redis: XACK embed_stream
```

---

## 5. Stale job reclaim and DLQ

```mermaid
sequenceDiagram
  participant Claim as Claim loop
  participant Redis as Redis
  participant Worker as processFn
  participant DLQ as dlq_stream

  loop Every ~30s
    Claim->>Redis: XAUTOCLAIM idle > threshold
    alt retries < MAX_RETRIES
      Redis-->>Claim: stale message
      Claim->>Worker: reprocess payload
      Worker->>Redis: XACK on success
    else max retries
      Claim->>DLQ: XADD failure metadata
      Claim->>Redis: XACK original (or drop per policy)
    end
  end
```

---

## 6. Default RAG chat (SSE)

```mermaid
sequenceDiagram
  actor User
  participant Web as Chat UI
  participant API as POST /chat/message
  participant PG as Postgres
  participant HR as hybridRetrieve
  participant Qdrant as Qdrant
  participant CE as Cross-encoder
  participant OR as OpenRouter

  User->>Web: Send message
  Web->>API: POST /api/v1/chat/message {message, chatId?}
  API->>PG: Resolve/create Chat (userId)
  API->>PG: INSERT Message role=user

  API->>HR: hybridRetrieve(userId, message)
  HR->>PG: owned document IDs
  HR->>HR: embed query
  HR->>Qdrant: hybrid RRF + filter
  Qdrant-->>HR: points
  HR-->>API: chunks
  API->>CE: rerank top 5
  CE-->>API: ranked

  API->>PG: history + project prompt + memories
  API-->>Web: SSE meta {chatId, sources, userMessage}
  API->>OR: chat.stream(system + history)
  loop tokens
    OR-->>API: delta
    API-->>Web: SSE delta {content}
  end
  API->>PG: INSERT assistant Message + sourceChunks
  API-->>Web: SSE done {assistantMessage, sources}
  API->>API: async extract memories / summarize
```

---

## 7. Web research agent (`/web`)

```mermaid
sequenceDiagram
  actor User
  participant API as Chat API
  participant Graph as LangGraph web agent
  participant Exa as Exa API
  participant LLM as OpenRouter LLM

  User->>API: message "/web latest on X"
  API-->>User: SSE meta mode=web
  API->>Graph: runWebSearchAgent(query)

  loop up to MAX_ITERATIONS
    Graph->>Exa: search(nextQuery)
    Exa-->>Graph: hits
    API-->>User: SSE agent_step search
    Graph->>LLM: reason enough?
    LLM-->>Graph: decision
    API-->>User: SSE agent_step reason
  end

  Graph->>LLM: write answer from hits
  LLM-->>Graph: answer
  API-->>User: SSE delta + done (sources with URLs)
```

---

## 8. Multi-hop memory agent (`/agent`)

```mermaid
sequenceDiagram
  actor User
  participant API as Chat API
  participant Graph as LangGraph memory agent
  participant HR as hybridRetrieve
  participant LLM as LLM

  User->>API: "/agent compare Q3 goals…"
  API-->>User: SSE meta mode=agent
  API->>Graph: runMemoryAgent(query, userId)

  Graph->>LLM: plan sub-queries
  API-->>User: SSE agent_step plan

  loop up to MAX_HOPS
    Graph->>HR: retrieve(nextQuery)
    HR-->>Graph: chunks
    API-->>User: SSE agent_step retrieve
    Graph->>LLM: enough information?
    LLM-->>Graph: decision + nextQuery?
    API-->>User: SSE agent_step reason
  end

  Graph->>LLM: answer from accumulated chunks
  API-->>User: SSE delta + done + grounded sources
```

---

## 9. Document search (library UI)

```mermaid
sequenceDiagram
  participant Web as Dashboard Search
  participant API as POST /search
  participant HR as hybridRetrieve
  participant PG as Postgres

  Web->>API: {query, limit, offset, modality?}
  API->>HR: hybridRetrieve (higher chunk limit)
  HR-->>API: chunks
  API->>API: aggregateByDocument + confidence
  API->>PG: load Document metadata for page
  API-->>Web: {documents[], hasMore, nextOffset}
```

---

## 10. Download and delete document

```mermaid
sequenceDiagram
  participant Web as Client
  participant API as Download API
  participant PG as Postgres
  participant MinIO as MinIO
  participant Qdrant as Qdrant
  participant Redis as Redis

  Note over Web,API: Download
  Web->>API: POST /download/get-download-url {key}
  API->>PG: find Document where ObjectKey+userId
  alt not owner
    API-->>Web: 403
  else
    API->>MinIO: presign GetObject
    API-->>Web: {presignedUrl}
  end

  Note over Web,API: Delete
  Web->>API: DELETE /download/:id
  API->>PG: find by id+userId
  API->>Redis: remove from all streams
  API->>MinIO: DeleteObject
  API->>Qdrant: delete points by documentId
  API->>PG: DELETE Document (cascades chunk sets)
  API-->>Web: 200
```

---

## 11. Connector create and continuous sync

```mermaid
sequenceDiagram
  actor User
  participant Web as Dashboard
  participant API as Connectors API
  participant PG as Postgres
  participant Sync as runConnectorSync
  participant Net as External URL/API
  participant MinIO as MinIO
  participant Redis as Redis

  User->>Web: Create URL/RSS/GitHub connector
  Web->>API: POST /connectors {type, name, config}
  API->>API: sanitize config + SSRF validate URLs
  API->>PG: INSERT Connector ACTIVE
  API-->>Web: connector (token redacted)
  API->>Sync: async first sync

  Sync->>PG: INSERT ConnectorSyncJob RUNNING
  Sync->>Net: safeFetch (public IPs only)
  Net-->>Sync: HTML/XML/text
  Sync->>MinIO: PutObject text
  Sync->>PG: Document + ParsedChunkSet
  Sync->>Redis: XADD embed_stream
  Sync->>PG: job SUCCESS, lastSyncedAt

  loop every CONNECTOR_SYNC_POLL_MS
    API->>PG: ACTIVE connectors past interval
    API->>Sync: runConnectorSync(id)
  end
```

---

## 12. Long-term memory extract (post-chat)

```mermaid
sequenceDiagram
  participant Chat as Chat pipeline
  participant Mem as extractAndStoreMemories
  participant LLM as OpenRouter
  participant PG as Postgres
  participant Next as Future chat turn

  Chat->>Mem: userMessage + assistantMessage
  Mem->>PG: load existing memories
  Mem->>LLM: extract JSON facts (fenced untrusted input)
  LLM-->>Mem: {memories:[{fact, importance}]}
  Mem->>PG: INSERT Memory rows (max 3)

  Next->>PG: getMemoriesForPrompt (top by importance)
  Next->>Next: inject fenced memories into system prompt
```

---

## Legend

| Arrow style | Meaning |
|-------------|---------|
| Solid | Synchronous request/response |
| SSE notes | Server-Sent Events stream to client |
| Async | Fire-and-forget after response (memories, first connector sync) |
