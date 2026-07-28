import { createAuthClient } from "better-auth/react";

/** Backend origin that hosts Better Auth (`/api/auth/*`). */
export const AUTH_BASE_URL =
  process.env.NEXT_PUBLIC_BETTER_AUTH_URL ?? "http://localhost:3000";

export const authClient = createAuthClient({
  baseURL: AUTH_BASE_URL,
});

export const { signIn, signOut, useSession, getSession } = authClient;
