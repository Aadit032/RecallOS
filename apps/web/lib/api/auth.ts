import { authClient } from "@/lib/auth-client"

/**
 * Start Google OAuth sign-in. Redirects to Google, then back to callbackURL.
 */
export async function signInWithGoogle(callbackURL = "/dashboard") {
  const result = await authClient.signIn.social({
    provider: "google",
    callbackURL,
  })
  return result
}

/**
 * End the current session (server-side revoke + clear cookie).
 */
export async function signOut() {
  await authClient.signOut()
}

/**
 * Fetch the current session from the auth server.
 * Returns null when unauthenticated.
 */
export async function getSession() {
  const { data } = await authClient.getSession()
  return data
}
