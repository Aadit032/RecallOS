/**
 * @deprecated Username/password JWT auth has been replaced by Better Auth
 * (Google OAuth + cookie sessions). See `apps/backend/auth.ts` and the
 * `/api/auth/*` handler mounted in `apps/backend/index.ts`.
 *
 * This router is no longer mounted.
 */
import { Router } from "express";

const authRouter = Router();

authRouter.all("*splat", (_req, res) => {
  res.status(410).json({
    message:
      "JWT username/password auth has been removed. Use Google OAuth via /api/auth.",
  });
});

export default authRouter;
