import type { Response } from "express";

/**
 * Safe client-facing errors: never echo raw exception objects/stack traces.
 */
export function sendSafeError(
  res: Response,
  status: number,
  clientMessage: string,
  err?: unknown,
  logLabel?: string
): void {
  if (err !== undefined) {
    console.error(`[${logLabel ?? "error"}]`, err);
  }
  if (res.headersSent) return;
  res.status(status).json({ message: clientMessage });
}

export function clientErrorMessage(err: unknown, fallback: string): string {
  // Only return our own Error messages that are intentional validation failures
  // (short, no stack). Never pass through unknown object shapes.
  if (err instanceof Error) {
    const msg = err.message;
    if (
      msg.length > 0 &&
      msg.length <= 200 &&
      !msg.includes("\n") &&
      !/ECONN|ENOENT|prisma|postgres|redis|stack|at\s+\//i.test(msg)
    ) {
      // Prefer generic for infrastructure; allow validation-style messages
      if (/unsafe|invalid|required|not allowed|forbidden|not found|too large|mime|url|repo|path/i.test(msg)) {
        return msg;
      }
    }
  }
  return fallback;
}
