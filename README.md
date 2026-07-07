<div align="center">

```text
██████╗ ███████╗ ██████╗ █████╗ ██╗     ██╗           ██████╗ ███████╗
██╔══██╗██╔════╝██╔════╝██╔══██╗██║     ██║          ██╔═══██╗██╔════╝
██████╔╝█████╗  ██║     ███████║██║     ██║    ████╗ ██║   ██║███████╗
██╔══██╗██╔══╝  ██║     ██╔══██║██║     ██║          ██║   ██║╚════██║
██║  ██║███████╗╚██████╗██║  ██║███████╗███████╗     ╚██████╔╝███████║
╚═╝  ╚═╝╚══════╝ ╚═════╝╚═╝  ╚═╝╚══════╝╚══════╝      ╚═════╝ ╚══════╝
```

### 🧠 Enterprise Knowledge OS powered by AI Agents

Store. Remember. Retrieve. Reason.

</div>

---

# ✨ What is RecallOS?

RecallOS is an **AI-native enterprise knowledge operating system** that allows organizations to ingest, organize, search and reason over every piece of company knowledge.

Instead of acting as another document storage platform, RecallOS builds a searchable memory for your organization using:

- 📄 PDFs
- 📊 PowerPoints
- 🖼 Images
- 🎥 Videos
- 📝 Notes
- 💬 Conversations

It combines **hybrid retrieval (BM25 + Vector Search)**, **LLM-powered reasoning**, **agentic workflows**, and **long-term organizational memory**.

---

# 🏗 Tech Stack

| Layer | Technology |
|--------|------------|
| Monorepo | Bun + Turborepo |
| Frontend | Next.js |
| Backend | Express |
| Queue | Redis Streams |
| Object Storage | MinIO (S3) |
| Metadata | PostgreSQL |
| Vector Search | Qdrant |
| Lexical Search | OpenSearch (BM25) |
| Parsing | LlamaParse |
| Speech | Whisper |
| Vision | Vision LLM |
| LLM | Provider Agnostic |

---

# 📂 Repository Structure

```text
apps/
    web/
    api/
    worker/

packages/
    ui/
    types/
    shared/
    config/
```

---

# 🚀 High Level Architecture

```text
                        +----------------------+
                        |      Frontend        |
                        +----------+-----------+
                                   |
                     Upload using Presigned URL
                                   |
                                   v
                         +------------------+
                         |      MinIO       |
                         |  Original Files  |
                         +------------------+

                                   |
                             Metadata Event
                                   |
                                   v

                         +------------------+
                         | Redis Streams    |
                         +--------+---------+
                                  |
                                  |
                     +------------+------------+
                     |                         |
             Ingestion Worker           Future Workers
                     |
                     v

              +------------------+
              |   LlamaParse     |
              +------------------+
                     |
                     |
      --------------------------------------------
      |                |                 |
      |                |                 |
 Structured Text     Images          Tables
      |                |
      |                |
Chunk Semantically   Vision Model
      |                |
      +--------+-------+
               |
      Chunk Enrichment
               |
      (summary + metadata)
               |
      Embedding Generation
               |
      +---------+-----------+
      |                     |
      |                     |
      v                     v

  OpenSearch          Qdrant
   (BM25)          (Embeddings)

               |
               |
         PostgreSQL
(Document Metadata)
```

---

# 📥 Ingestion Flow

```text
User Upload

↓

MinIO

↓

Redis Stream Event

↓

Worker

↓

LlamaParse

↓

Semantic Chunking

↓

Chunk Enrichment

↓

Embeddings

↓

Store in

• PostgreSQL
• Qdrant
• OpenSearch
```

---

# 📚 Chunk Enrichment

Every chunk is enriched before indexing.

```yaml
Document Summary

Chunk Summary

Section Title

Keywords

Entities

Page Number

Tags

Document ID

User ID
```

This dramatically improves retrieval quality.

---

# 🗃 Storage Layer

## 🪣 MinIO

Stores

- Original PDFs
- Images
- Videos
- PPTs

---

## 🐘 PostgreSQL

Stores metadata.

```text
Documents

id
title
tags
summary
type
owner
bucket_key
status
created_at
```

```text
Chunks

id
document_id
page
section
summary
chunk_index
```

---

## 🔍 OpenSearch

Stores every chunk for lexical retrieval.

```text
Chunk

↓

Tokenization

↓

Inverted Index

↓

BM25 Ranking
```

Perfect for

- exact matches
- APIs
- code
- filenames
- keywords

---

## 🧠 Qdrant

Stores

```text
Embedding

↓

Vector Search

↓

Cosine Similarity
```

Perfect for semantic search.

---

# 🔎 Retrieval Architecture

```text
                        User Query
                             |
                             |
                     Query Rewriter
                             |
                +------------+------------+
                |                         |
                |                         |
          Generate               Original Query
         Embeddings
                |                         |
                |                         |
                v                         v

            Qdrant                 OpenSearch

        Top 100 Results         Top 100 Results

                \                 /

                 \               /

               Reciprocal Rank Fusion

                         |

                    Top 30 Chunks

                         |

                 Cross Encoder Reranker

                         |

                     Top 5 Chunks

                         |

                         LLM

                         |

                      Final Answer
```

---

# 📌 Why Hybrid Retrieval?

Vector Search

✅ understands meaning

❌ poor at exact keywords

---

BM25

✅ exact matching

❌ no semantic understanding

---

RRF combines both.

```text
Vector Results

+

BM25 Results

↓

RRF

↓

Best Combined Ranking
```

---

# 🖼 Image Retrieval

Images are indexed independently.

```text
Image

↓

Vision Model

↓

Caption

↓

OCR

↓

Embedding

↓

Image Collection
```

Example

> Show me the transformer architecture diagram.

Returns

✅ Image

✅ Caption

✅ Source document

---

# 🎥 Video Retrieval

```text
Video

↓

Whisper

↓

Transcript

↓

Chunk

↓

Embedding
```

Also

```text
Video

↓

Extract Keyframes

↓

Vision Model

↓

Frame Captions

↓

Embedding
```

Allows queries like

> Show the latency graph shown in the meeting.

---

# 🧠 Organizational Memory

Every conversation can become memory.

```text
Conversation

↓

Extract Facts

↓

Importance Scoring

↓

Memory Chunks

↓

Embedding

↓

Memory Collection
```

Instead of storing chat history, RecallOS stores reusable knowledge.

---

# 🤖 Agent Architecture

```text
User Query

↓

Planner Agent

↓

Choose Tools

↓

Execute

↓

Answer
```

Available tools

- 🔍 Search Knowledge Base
- 🌐 Web Search
- 📄 Generate Reports
- 📊 Generate Presentations
- 🖼 Retrieve Images
- 🎥 Retrieve Videos
- 🧠 Search Memory

---

# 🌍 Web Search

If retrieval confidence is low

```text
Knowledge Search

↓

Low Confidence

↓

Agent

↓

Web Search

↓

Combine Results

↓

Answer
```

---

# 📑 Report Generation

```text
Query

↓

Retrieve Context

↓

Planner

↓

Outline

↓

Generate Report

↓

Markdown / PDF / PPT
```

---

# 🎯 Retrieval Citations

Every response includes source chunks.

```text
Answer

↓

Referenced Chunks

↓

Page

↓

Document

↓

Highlight
```

Users can inspect exactly where every answer came from.

---

# 🔮 Future Roadmap

- ✅ Multi-agent workflows
- ✅ Graph-based memory
- ✅ Knowledge graph extraction
- ✅ Scheduled agents
- ✅ Slack / Discord / Gmail connectors
- ✅ Codebase indexing
- ✅ Calendar integration
- ✅ Organization-wide semantic memory
- ✅ MCP support
- ✅ Voice interface

---

# 💡 Design Principles

- 🧠 Memory First
- ⚡ Async Everything
- 🔍 Hybrid Retrieval
- 🤖 Agent Native
- 📚 Source Grounded
- 🧩 Modular Architecture
- 🚀 Horizontally Scalable
- 🔒 Enterprise Ready

---

<div align="center">

### RecallOS

**The operating system for organizational memory.**

*"Your company's second brain."*

</div>

--- 

1. use CLAP to combine audio and text in the same embedding space
2. for images use text + vector space search