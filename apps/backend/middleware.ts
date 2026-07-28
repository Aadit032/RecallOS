import type { Request, Response, NextFunction } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth.ts";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/**
 * Session middleware — replaces JWT Bearer auth.
 * Validates the Better Auth session cookie and sets req.userId for route handlers.
 * Session expiry + sliding renewal is handled by Better Auth (expiresIn / updateAge).
 */
export default async function middleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const method = req.method;
  const path = req.path;
  console.log(`[middleware] Entry — ${method} ${path}`);

  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session?.user?.id) {
      console.warn(`[middleware] No session — ${method} ${path}`);
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    req.userId = session.user.id;
    console.log(
      `[middleware] Authenticated: userId=${req.userId} — ${method} ${path}`
    );
    next();
  } catch (e) {
    console.error(
      `[middleware] Session verification failed — ${method} ${path}:`,
      e
    );
    res.status(401).json({ error: "Unauthorized" });
  }
}
