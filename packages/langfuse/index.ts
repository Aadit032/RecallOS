/**
 * Shared Langfuse observability for RecallOS.
 *
 * Best practices applied:
 * - OpenTelemetry NodeSDK + LangfuseSpanProcessor (JS/TS SDK v5)
 * - Load env before processor init
 * - Graceful no-op when keys are missing (local dev without Langfuse)
 * - Masking for common secrets
 * - Helpers for nested spans, generations, and OpenRouter usage/cost
 *
 * @see https://langfuse.com/docs/observability/sdk/overview
 * @see https://langfuse.com/docs/observability/best-practices
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  startActiveObservation,
  startObservation,
  updateActiveObservation,
  observe,
  getActiveTraceId,
  getActiveSpanId,
  propagateAttributes,
} from "@langfuse/tracing";
import type {
  LangfuseGenerationAttributes,
  LangfuseObservationType,
  LangfuseSpanAttributes,
} from "@langfuse/tracing";
import { CallbackHandler } from "@langfuse/langchain";
import dotenv from "dotenv";

dotenv.config();

export {
  startActiveObservation,
  startObservation,
  updateActiveObservation,
  observe,
  getActiveTraceId,
  getActiveSpanId,
  propagateAttributes,
  CallbackHandler,
};

export type { LangfuseGenerationAttributes, LangfuseSpanAttributes, LangfuseObservationType };

let sdk: NodeSDK | null = null;
let initialized = false;
let enabled = false;

export type InitTracingOptions = {
  /** Logical service name for logs / debugging (e.g. "backend", "workers") */
  serviceName?: string;
  /** Force enable/disable regardless of env keys */
  enabled?: boolean;
};


// Mask API keys, JWTs, and common secret patterns before export to Langfuse.
function maskSensitiveData(data: unknown): unknown {
  if (data == null) return data;
  if (typeof data === "string") {
    return data
      .replace(/sk-[a-zA-Z0-9_-]{10,}/g, "sk-***")
      .replace(/pk-lf-[a-zA-Z0-9_-]{10,}/g, "pk-lf-***")
      .replace(/sk-lf-[a-zA-Z0-9_-]{10,}/g, "sk-lf-***")
      .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer ***")
      .replace(
        /eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g,
        "[jwt-redacted]"
      );
  }
  if (Array.isArray(data)) {
    return data.map(maskSensitiveData);
  }
  if (typeof data === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (/password|secret|api[_-]?key|token|authorization/i.test(k)) {
        out[k] = "***";
      } else {
        out[k] = maskSensitiveData(v);
      }
    }
    return out;
  }
  return data;
}

/**
 * Initialize OpenTelemetry + Langfuse export. Safe to call once per process.
 * Must run at the entrypoint before LLM / agent code executes.
 */
export function initTracing(options: InitTracingOptions = {}): boolean {
  if (initialized) return enabled;

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  const baseUrl = process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com";

  const wantEnabled = options.enabled ?? process.env.LANGFUSE_TRACING_ENABLED !== "false";

  if (!wantEnabled || !publicKey || !secretKey) {
    initialized = true;
    enabled = false;
    console.log(`[langfuse] Tracing disabled for ${options.serviceName ?? "app"} ` + `(missing LANGFUSE_PUBLIC_KEY/SECRET_KEY or LANGFUSE_TRACING_ENABLED=false)`);
    return false;
  }

  try {
    const environment = process.env.LANGFUSE_TRACING_ENVIRONMENT ?? "development";

    const processor = new LangfuseSpanProcessor({
      publicKey,
      secretKey,
      baseUrl,
      environment,
      exportMode: "batched",
      mask: ({ data }) => maskSensitiveData(data),
    });

    sdk = new NodeSDK({ spanProcessors: [processor] });
    sdk.start();

    initialized = true;
    enabled = true;

    console.log(`[langfuse] Tracing enabled for ${options.serviceName ?? "app"} ` + `(env=${environment}, baseUrl=${baseUrl})`);

    const flush = async () => {
      try {
        await sdk?.shutdown();
      } catch (e) {
        console.warn("[langfuse] shutdown error:", e);
      }
    };

    process.once("SIGTERM", () => { void flush().finally(() => process.exit(0)) });
    process.once("SIGINT", () => { void flush().finally(() => process.exit(0)) });
    process.once("beforeExit", () => { void flush() });

    return true;
  } catch (e) {
    initialized = true;
    enabled = false;
    console.error("[langfuse] Failed to initialize tracing:", e);
    return false;
  }
}

export function isTracingEnabled(): boolean {
  return enabled;
}

/** Flush pending spans (useful in tests / short-lived scripts). */
export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
    initialized = false;
    enabled = false;
  }
}

/** Truncate long strings for trace I/O readability. */
export function truncateForTrace(
  value: string,
  max = 2_000
): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}… [truncated ${value.length - max} chars]`;
}

/** OpenRouter-style usage object (prompt/completion tokens + optional cost). */
export type OpenRouterUsageLike = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number | null;
};

export function usageFromOpenRouter(
  usage: OpenRouterUsageLike | null | undefined
): {
  usageDetails?: Record<string, number>;
  costDetails?: Record<string, number>;
} {
  if (!usage) return {};

  const input = usage.promptTokens ?? usage.prompt_tokens ?? undefined;
  const output = usage.completionTokens ?? usage.completion_tokens ?? undefined;
  const total = usage.totalTokens ?? usage.total_tokens ?? (input != null && output != null ? input + output : undefined);

  const usageDetails: Record<string, number> = {};
  if (input != null) usageDetails.input = input;
  if (output != null) usageDetails.output = output;
  if (total != null) usageDetails.total = total;

  const costDetails: Record<string, number> = {};
  if (typeof usage.cost === "number" && Number.isFinite(usage.cost)) {
    costDetails.total = usage.cost;
  }

  return {
    ...(Object.keys(usageDetails).length > 0 ? { usageDetails } : {}),
    ...(Object.keys(costDetails).length > 0 ? { costDetails } : {}),
  };
}

//  Trace a non-streaming OpenRouter (or compatible) chat completion as a generation.
export async function withGeneration<T>(
  name: string,
  params: {
    model: string;
    input: unknown;
    metadata?: Record<string, unknown>;
  },
  fn: () => Promise<{
    output: T;
    usage?: OpenRouterUsageLike | null;
    model?: string;
  }>
): Promise<T> {
  return startActiveObservation(
    name,
    async (generation) => {
      generation.update({
        model: params.model,
        input: params.input,
        metadata: params.metadata,
      });

      try {
        const result = await fn();
        const usageAttrs = usageFromOpenRouter(result.usage);
        generation.update({
          output: result.output,
          model: result.model ?? params.model,
          ...usageAttrs,
        });
        return result.output;
      } catch (err) {
        generation.update({
          level: "ERROR",
          statusMessage:
            err instanceof Error ? err.message : String(err),
          output: {
            error: err instanceof Error ? err.message : String(err),
          },
        });
        throw err;
      }
    },
    { asType: "generation" }
  );
}

/**
 * Trace a streaming OpenRouter completion: call `onChunk` for each delta,
 * then finalize usage when the stream ends.
 */
export async function withStreamingGeneration(
  name: string,
  params: {
    model: string;
    input: unknown;
    metadata?: Record<string, unknown>;
  },
  fn: (ctx: {
    /** Append partial text (optional; final output set via finish). */
    noteCompletionStart: () => void;
  }) => Promise<{
    output: string;
    usage?: OpenRouterUsageLike | null;
    model?: string;
  }>
): Promise<string> {
  return startActiveObservation(
    name,
    async (generation) => {
      generation.update({
        model: params.model,
        input: params.input,
        metadata: params.metadata,
      });

      try {
        const result = await fn({
          noteCompletionStart: () => {
            generation.update({ completionStartTime: new Date() });
          },
        });
        const usageAttrs = usageFromOpenRouter(result.usage);
        generation.update({
          output: result.output,
          model: result.model ?? params.model,
          ...usageAttrs,
        });
        return result.output;
      } catch (err) {
        generation.update({
          level: "ERROR",
          statusMessage:
            err instanceof Error ? err.message : String(err),
          output: {
            error: err instanceof Error ? err.message : String(err),
          },
        });
        throw err;
      }
    },
    { asType: "generation" }
  );
}

/**
 * Create a LangChain CallbackHandler bound to the current request context.
 * Prefer calling inside an active observation so nesting is preserved.
 */
export function createLangChainHandler(params?: {
  userId?: string;
  sessionId?: string;
  tags?: string[];
  version?: string;
  traceMetadata?: Record<string, unknown>;
}): CallbackHandler {
  return new CallbackHandler({
    userId: params?.userId,
    sessionId: params?.sessionId,
    tags: params?.tags,
    version: params?.version,
    traceMetadata: params?.traceMetadata,
  });
}
