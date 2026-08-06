# Mermaid diagrams

Architecture visuals for RecallOS. Rendered by GitHub, VS Code Markdown preview, and [Mermaid Live](https://mermaid.live).

Also see: [Architecture](./architecture.md) · [Sequence diagrams](./sequence-diagrams.md)

---

## System context (C4-style)

```mermaid
C4Context
  title RecallOS System Context

  Person(user, "User", "Uploads docs, chats with library")
  System(recallos, "RecallOS", "Ingest, index, hybrid RAG chat")
  System_Ext(google, "Google OAuth", "Identity")
  System_Ext(openrouter, "OpenRouter", "LLM / STT / vision")
  System_Ext(llama, "LlamaCloud", "PDF parsing")
  System_Ext(exa, "Exa", "Web search")
  System_Ext(hf, "HuggingFace", "Cross-encoder")
  System_Ext(langfuse, "Langfuse", "Tracing")

  Rel(user, recallos, "HTTPS / cookies")
  Rel(recallos, google, "OAuth")
  Rel(recallos, openrouter, "API")
  Rel(recallos, llama, "API")
  Rel(recallos, exa, "API")
  Rel(recallos, hf, "API")
  Rel(recallos, langfuse, "OTLP / SDK")
```

> If your Mermaid renderer does not support C4, use the flowchart in [Architecture §2](./architecture.md#2-high-level-system).

---

## Container diagram

```mermaid
flowchart TB
  subgraph edge [Edge]
    U[User browser]
  end

  subgraph app [Application tier]
    WEB[Next.js web]
    API[Express API]
    WRK[Worker process]
  end

  subgraph store [Stateful services]
    PG[(Postgres)]
    RD[(Redis)]
    S3[(MinIO)]
    QD[(Qdrant)]
  end

  U --> WEB
  U --> API
  U --> S3
  WEB --> API
  API --> PG & RD & S3 & QD
  WRK --> PG & RD & S3 & QD
```

---

## Monorepo package graph

```mermaid
flowchart LR
  web[apps/web] --> ui[@repo/ui]
  backend[apps/backend] --> prisma[@repo/prisma]
  backend --> minio[@repo/minio]
  backend --> redis[@repo/redis-stream]
  backend --> qdrant[@repo/qdrant]
  backend --> embed[@repo/embed]
  backend --> openrouter[@repo/openrouter]
  backend --> langfuse[@repo/langfuse]
  workers[apps/workers] --> prisma
  workers --> minio
  workers --> redis
  workers --> qdrant
  workers --> embed
  workers --> openrouter
  workers --> langfuse
  prisma --> PG[(Postgres)]
  minio --> S3[(MinIO)]
  redis --> RD[(Redis)]
  qdrant --> QD[(Qdrant)]
```

---

## Ingestion data flow

```mermaid
flowchart LR
  Client -->|1 presign| API
  Client -->|2 PUT bytes| MinIO
  Client -->|3 confirm| API
  API -->|4 Document UPLOADED| PG[(Postgres)]
  API -->|5 XADD files_stream| Redis
  Disp[Dispatcher] -->|6 XREADGROUP| Redis
  Disp -->|7 XADD modality stream| Redis
  Parser[Modality worker] -->|8 download| MinIO
  Parser -->|9 ParsedChunkSet| PG
  Parser -->|10 XADD embed_stream| Redis
  Emb[Embedder] -->|11 vectors| Qdrant
  Emb -->|12 READY| PG
```

---

## Chat / RAG data flow

```mermaid
flowchart TD
  User[User message] --> API[Chat API]
  API --> Hist[Load chat history]
  API --> Mem[Load long-term memories]
  API --> HR[hybridRetrieve]
  HR --> Own[Owned document IDs]
  HR --> Emb[Embed query]
  Emb --> Q[Qdrant RRF]
  Q --> RR[Cross-encoder]
  RR --> Prompt[Build system prompt]
  Hist --> Prompt
  Mem --> Prompt
  Prompt --> Stream[OpenRouter stream]
  Stream --> SSE[SSE deltas]
  SSE --> UI[Chat UI]
  Stream --> Persist[Persist assistant message + sources]
  Persist --> MemX[Async memory extract]
  Persist --> Sum[Async summary if threshold]
```

---

## Redis stream topology

```mermaid
flowchart TB
  FS[files_stream] --> Disp[Dispatcher]
  Disp --> PDF[pdf_stream]
  Disp --> IMG[image_stream]
  Disp --> AUD[audio_stream]
  Disp --> VID[video_stream]
  VID --> SCN[scene_stream]
  PDF --> EMB[embed_stream]
  IMG --> EMB
  AUD --> EMB
  SCN --> EMB
  FS -.->|stale max retries| DLQ[dlq_stream]
  PDF -.-> DLQ
  IMG -.-> DLQ
  AUD -.-> DLQ
  VID -.-> DLQ
  SCN -.-> DLQ
  EMB -.-> DLQ
```

---

## Document status lifecycle

```mermaid
stateDiagram-v2
  direction LR
  [*] --> UPLOADED
  UPLOADED --> QUEUED
  QUEUED --> PARSING
  PARSING --> PROCESSING: video/scene
  PARSING --> PARSED
  PROCESSING --> PARSED
  PARSED --> EMBEDDING
  EMBEDDING --> INDEXED
  INDEXED --> READY
  EMBEDDING --> READY
  PARSING --> FAILED
  EMBEDDING --> FAILED
  FAILED --> RETRYING
  RETRYING --> QUEUED
  READY --> [*]
```

---

## Entity relationship

```mermaid
erDiagram
  User ||--o{ Session : has
  User ||--o{ Account : has
  User ||--o{ Document : owns
  User ||--o{ Chat : owns
  User ||--o{ Project : owns
  User ||--o{ Memory : owns
  User ||--o{ Connector : owns

  Document ||--o{ ParsedChunkSet : has
  ParsedChunkSet ||--o{ ParsedChunk : has

  Project ||--o{ Chat : groups
  Chat ||--o{ Message : contains

  Connector ||--o{ ConnectorSyncJob : runs

  User {
    uuid id PK
    string email UK
    string username UK
    string name
  }

  Document {
    uuid id PK
    string title
    string ObjectKey UK
    string mimeType
    string modality
    enum status
    string[] tags
    uuid userId FK
  }

  ParsedChunkSet {
    uuid id PK
    string modality
    string status
    uuid documentId FK
  }

  ParsedChunk {
    uuid id PK
    text text
    json metadata
    uuid chunkSetId FK
  }

  Chat {
    uuid id PK
    string title
    boolean pinned
    string summary
    uuid userId FK
    uuid projectId FK
  }

  Message {
    uuid id PK
    string role
    text content
    json sourceChunks
    uuid chatId FK
  }

  Project {
    uuid id PK
    string name
    text systemPrompt
    uuid userId FK
  }

  Memory {
    uuid id PK
    string fact
    int importance
    enum source
    uuid userId FK
  }

  Connector {
    uuid id PK
    enum type
    string name
    json config
    enum status
    int syncInterval
    uuid userId FK
  }
```

---

## Auth trust boundary

```mermaid
flowchart LR
  subgraph browser [Browser]
    SPA[SPA]
    Cookie[HttpOnly session cookie]
  end

  subgraph api [API host]
    Auth[/api/auth/* Better Auth/]
    MW[Session middleware]
    R[v1 routers]
  end

  subgraph idp [IdP]
    G[Google]
  end

  SPA -->|OAuth start| Auth
  Auth --> G
  G --> Auth
  Auth -->|Set-Cookie| Cookie
  SPA -->|credentials include| MW
  Cookie --> MW
  MW -->|req.userId| R
```

---

## Hybrid retrieval internals

```mermaid
flowchart TB
  Query[Query text] --> Dense[Dense embed BGE-small 384d]
  Query --> Sparse[Sparse embed SPLADE]
  Dense --> PrefD[Qdrant prefetch using dense]
  Sparse --> PrefS[Qdrant prefetch using splade]
  PrefD --> RRF[Fusion RRF]
  PrefS --> RRF
  Filter[must: documentId any owned] --> PrefD
  Filter --> PrefS
  Filter --> RRF
  RRF --> Points[Top N points + payload]
  Points --> OwnCheck[Drop non-owned]
  OwnCheck --> Boost[Tag match boost]
  Boost --> Out[RetrievedChunk list]
```

---

## Agent graphs

### Web agent (`/web`)

```mermaid
flowchart LR
  Start([START]) --> Search[do_search Exa]
  Search --> Reason[reason LLM]
  Reason -->|enough or max iters| Answer[write_answer]
  Reason -->|need more| Search
  Answer --> End([END])
```

### Memory agent (`/agent`)

```mermaid
flowchart LR
  Start([START]) --> Plan[plan sub-queries]
  Plan --> Ret[do_retrieve hybrid]
  Ret --> Reason[reason sufficiency]
  Reason -->|enough or max hops| Ans[write_answer]
  Reason -->|need more| Ret
  Ans --> End([END])
```

---

## Local development topology

```mermaid
flowchart TB
  subgraph host [Developer machine]
    WEB[web :3001]
    API[backend :3000]
    WRK[workers]
  end

  subgraph docker [Docker containers]
    PG[postgres :5432]
    RD[redis :6379]
    MIN[minio :9000/:9001]
    QD[qdrant :6333]
  end

  WEB --> API
  API --> PG & RD & MIN & QD
  WRK --> PG & RD & MIN & QD
```

---

## Production deployment (reference)

```mermaid
flowchart TB
  Users((Users)) --> LB[Load balancer / TLS]
  LB --> WEB[Web replicas]
  LB --> API[API replicas]
  WEB --> API
  API --> PG[(Managed Postgres)]
  API --> RD[(Managed Redis)]
  API --> S3[(S3 or MinIO cluster)]
  API --> QD[(Qdrant cluster)]
  WRK[Worker pool] --> PG & RD & S3 & QD
  API --> Secrets[Secrets manager]
  WRK --> Secrets
```

See [Deployment guide](./deployment.md) for concrete steps.
