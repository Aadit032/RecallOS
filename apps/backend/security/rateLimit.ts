import type { Request, Response, NextFunction } from "express";

type Bucket = { count: number; resetAt: number };

/**
 * Simple in-process sliding-window rate limiter keyed by userId or IP.
 * Suitable for single-instance deployments; use Redis for multi-instance.
 */
export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  /** Prefix for log/key namespace */
  name: string;
  keyFn?: (req: Request) => string;
}) {
  const buckets = new Map<string, Bucket>();
  const { windowMs, max, name } = options;
  const keyFn =
    options.keyFn ??
    ((req: Request) => req.userId ?? req.ip ?? req.socket.remoteAddress ?? "anon");

  // Periodic cleanup to avoid unbounded growth
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k);
    }
  }, Math.min(windowMs, 60_000));
  // Don't keep process alive solely for cleanup (Node); Bun ignores usually
  if (typeof cleanup.unref === "function") cleanup.unref();

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
    const key = `${name}:${keyFn(req)}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      console.warn(`[rateLimit:${name}] exceeded for ${key}`);
      res.status(429).json({ message: "Too many requests. Please try again later." });
      return;
    }
    next();
  };
}
