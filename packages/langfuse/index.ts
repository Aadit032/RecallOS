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
  input_tokens?: number;
  output_tokens?: number;
  cost?: number | null;
};

export function usageFromOpenRouter(
  usage: OpenRouterUsageLike | null | undefined
): {
  usageDetails?: Record<string, number>;
  costDetails?: Record<string, number>;
} {
  if (!usage) return {};

  const input =
    usage.promptTokens ??
    usage.prompt_tokens ??
    usage.input_tokens ??
    undefined;
  const output =
    usage.completionTokens ??
    usage.completion_tokens ??
    usage.output_tokens ??
    undefined;
  const total =
    usage.totalTokens ??
    usage.total_tokens ??
    (input != null && output != null ? input + output : undefined);

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

export type TokenUsageSummary = {
  input: number;
  output: number;
  total: number;
  cost: number;
};

export function emptyTokenUsage(): TokenUsageSummary {
  return { input: 0, output: 0, total: 0, cost: 0 };
}

export function mergeTokenUsage(
  base: TokenUsageSummary,
  delta: Partial<TokenUsageSummary>
): TokenUsageSummary {
  return {
    input: base.input + (delta.input ?? 0),
    output: base.output + (delta.output ?? 0),
    total: base.total + (delta.total ?? 0),
    cost: base.cost + (delta.cost ?? 0),
  };
}

export function tokenUsageFromOpenRouter(
  usage: OpenRouterUsageLike | null | undefined
): TokenUsageSummary | null {
  const { usageDetails, costDetails } = usageFromOpenRouter(usage);
  if (!usageDetails && !costDetails) return null;

  const input = usageDetails?.input ?? 0;
  const output = usageDetails?.output ?? 0;
  const total =
    usageDetails?.total ?? (input > 0 || output > 0 ? input + output : 0);
  const cost = costDetails?.total ?? 0;

  if (input === 0 && output === 0 && total === 0 && cost === 0) return null;
  return { input, output, total, cost };
}

/** Attach token totals to a root trace observation (output + metadata). */
export function traceTokenUsageFields(usage: TokenUsageSummary | null): {
  output?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  usageDetails?: Record<string, number>;
  costDetails?: Record<string, number>;
} {
  if (!usage || (usage.input === 0 && usage.output === 0 && usage.total === 0)) {
    return {};
  }

  const tokenUsage = {
    inputTokens: usage.input,
    outputTokens: usage.output,
    totalTokens: usage.total,
    ...(usage.cost > 0 ? { costUsd: usage.cost } : {}),
  };

  return {
    output: { tokenUsage },
    metadata: { tokenUsage },
    usageDetails: {
      input: usage.input,
      output: usage.output,
      total: usage.total,
    },
    ...(usage.cost > 0 ? { costDetails: { total: usage.cost } } : {}),
  };
}

function normalizeLangChainLlmUsage(raw: unknown): OpenRouterUsageLike | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;

  if ("input_tokens" in u || "output_tokens" in u || "total_tokens" in u) {
    return {
      prompt_tokens: u.input_tokens as number | undefined,
      completion_tokens: u.output_tokens as number | undefined,
      total_tokens: u.total_tokens as number | undefined,
      cost: typeof u.cost === "number" ? u.cost : undefined,
    };
  }

  return raw as OpenRouterUsageLike;
}

function patchLangChainLlmUsage(
  output: {
    generations: { message?: { usage_metadata?: unknown } }[][];
    llmOutput?: { tokenUsage?: unknown };
  },
  accumulated: TokenUsageSummary
): void {
  const lastBatch = output.generations[output.generations.length - 1];
  const lastGen = lastBatch?.[lastBatch.length - 1];
  if (!lastGen) return;

  const rawUsage =
    lastGen.message?.usage_metadata ?? output.llmOutput?.tokenUsage;
  const summary = tokenUsageFromOpenRouter(normalizeLangChainLlmUsage(rawUsage));
  if (!summary) return;

  Object.assign(accumulated, mergeTokenUsage(accumulated, summary));

  if (lastGen.message) {
    lastGen.message.usage_metadata = {
      input_tokens: summary.input,
      output_tokens: summary.output,
      total_tokens: summary.total,
    };
  }

  if (output.llmOutput) {
    output.llmOutput.tokenUsage = {
      promptTokens: summary.input,
      completionTokens: summary.output,
      totalTokens: summary.total,
      ...(summary.cost > 0 ? { cost: summary.cost } : {}),
    };
  }
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
): Promise<{ output: string; usage: TokenUsageSummary | null }> {
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
        return {
          output: result.output,
          usage: tokenUsageFromOpenRouter(result.usage),
        };
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

export type LangChainHandlerBundle = {
  handler: CallbackHandler;
  getTokenUsage: () => TokenUsageSummary;
};

/**
 * Create a LangChain CallbackHandler bound to the current request context.
 * Normalizes OpenRouter snake_case usage so Langfuse gets input/output/total tokens.
 * Prefer calling inside an active observation so nesting is preserved.
 */
export function createLangChainHandler(params?: {
  userId?: string;
  sessionId?: string;
  tags?: string[];
  version?: string;
  traceMetadata?: Record<string, unknown>;
}): LangChainHandlerBundle {
  const accumulated = emptyTokenUsage();
  const handler = new CallbackHandler({
    userId: params?.userId,
    sessionId: params?.sessionId,
    tags: params?.tags,
    version: params?.version,
    traceMetadata: params?.traceMetadata,
  });

  const originalHandleLLMEnd = handler.handleLLMEnd.bind(handler);
  handler.handleLLMEnd = async (output, runId, parentRunId) => {
    patchLangChainLlmUsage(
      output as {
        generations: { message?: { usage_metadata?: unknown } }[][];
        llmOutput?: { tokenUsage?: unknown };
      },
      accumulated
    );
    return originalHandleLLMEnd(output, runId, parentRunId);
  };

  return {
    handler,
    getTokenUsage: () => ({ ...accumulated }),
  };
}
