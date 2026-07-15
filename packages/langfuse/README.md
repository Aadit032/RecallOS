# @repo/langfuse

Shared Langfuse observability for RecallOS (JS/TS SDK v5 + OpenTelemetry).

## Setup

1. Create a project at [cloud.langfuse.com](https://cloud.langfuse.com) (or self-host).
2. Copy API keys into `apps/backend/.env` and `apps/workers/.env`:

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com
LANGFUSE_TRACING_ENVIRONMENT=development
LANGFUSE_TRACING_ENABLED=true
```

3. Start backend / workers as usual. You should see:

```text
[langfuse] Tracing enabled for backend (env=development, ...)
```

If keys are missing, tracing no-ops without crashing the app.

## What is traced

| Surface | Root observation | Nested steps |
| --- | --- | --- |
| Chat RAG (`POST /message`) | `chat-message` | `hybrid-retrieve` → `cross-encode-rerank` → `generate-response` (+ optional summaries) |
| Web agent (`/web …`) | `chat-message` → `web-research-agent` | LangGraph LLM nodes via `CallbackHandler` |
| Document ingest (workers) | `process-document` | `parse-document` → `chunk-document` → contextual LLM → `embed-and-upsert` |

Trace attributes (best practice):

- **userId** — authenticated user
- **sessionId** — chat id (groups multi-turn sessions in Langfuse)
- **tags** — `chat` / `memory` / `web` / `ingest`
- **environment** — via `LANGFUSE_TRACING_ENVIRONMENT`
- **generations** — model + token usage / cost when OpenRouter returns them

## Usage in code

```ts
import {
  initTracing,
  startActiveObservation,
  propagateAttributes,
  withGeneration,
} from "@repo/langfuse/client";

// Once at process entry (after dotenv)
initTracing({ serviceName: "backend" });

await startActiveObservation("my-pipeline", async (span) => {
  span.update({ input: { query } });
  await propagateAttributes({ userId, sessionId, tags: ["chat"] }, async () => {
    const answer = await withGeneration(
      "generate-response",
      { model: "openai/gpt-4o-mini", input: { query } },
      async () => {
        const res = await callLlm();
        return { output: res.text, usage: res.usage };
      }
    );
    span.update({ output: { answer } });
  });
});
```

## Docs

- [SDK overview](https://langfuse.com/docs/observability/sdk/overview)
- [Instrumentation](https://langfuse.com/docs/observability/sdk/instrumentation)
- [What does a good trace look like?](https://langfuse.com/docs/observability/best-practices)
- [LangChain / LangGraph](https://langfuse.com/docs/integrations/langchain)
