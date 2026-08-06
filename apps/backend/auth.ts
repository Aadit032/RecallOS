import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prismaClient } from "@repo/prisma/client";

const FRONTEND_URL =
  process.env.FRONTEND_URL ?? "http://localhost:3001";
// Auth handler lives on the Express backend (default port 3000).
const BETTER_AUTH_URL =
  process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

/**
 * Derive a unique username for the existing required `username` column.
 * Prefer email local-part; fall back to a short unique suffix on collision.
 */
async function uniqueUsernameFromEmail(email: string): Promise<string> {
  const local = email.split("@")[0]?.trim().toLowerCase() || "user";
  const base =
    local.replace(/[^a-z0-9._-]/gi, "").slice(0, 24) || "user";

  const existing = await prismaClient.user.findUnique({
    where: { username: base },
    select: { id: true },
  });
  if (!existing) return base;

  // Collision: append a short unique suffix (email is unique overall)
  return `${base.slice(0, 18)}_${crypto.randomUUID().slice(0, 6)}`;
}

const isProd =
  process.env.NODE_ENV === "production" ||
  (!BETTER_AUTH_URL.includes("localhost") && !BETTER_AUTH_URL.includes("127.0.0.1"));

export const auth = betterAuth({
  baseURL: BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [FRONTEND_URL],
  database: prismaAdapter(prismaClient, {
    provider: "postgresql",
  }),
  // Keep UUID ids consistent with existing User.id @default(uuid())
  advanced: {
    database: {
      generateId: () => crypto.randomUUID(),
    },
    // Secure cookies in production / non-localhost deployments
    useSecureCookies: isProd,
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      path: "/",
    },
  },
  // Cookie sessions: expire after 7 days; renew (sliding) once per day when used
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // renew expiry at most once per day
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 min signed cookie cache (avoids DB hit every request)
    },
  },
  user: {
    /**
     * Map our existing `username` column.
     * Must NOT be `required: true` — Google OAuth never sends it, and Better Auth
     * validates additionalFields *before* databaseHooks run (→ username_is_required).
     * We always populate it in `databaseHooks.user.create.before` instead.
     */
    additionalFields: {
      username: {
        type: "string",
        required: false,
        input: false,
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const email = user.email ?? "";
          const existing = (user as { username?: string | null }).username;
          const username =
            existing && existing.trim().length > 0
              ? existing
              : await uniqueUsernameFromEmail(email);
          return {
            data: {
              ...user,
              username,
            },
          };
        },
      },
    },
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      prompt: "select_account",
    },
  },
});

export type Session = typeof auth.$Infer.Session;
