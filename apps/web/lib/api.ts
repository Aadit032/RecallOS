import axios from "axios"

export const API_BASE = "http://localhost:3000/api/v1"
export const API_BASE_AUTH = `${API_BASE}/auth`
export const API_BASE_CHAT = `${API_BASE}/chat`
export const API_BASE_PROJECTS = `${API_BASE}/projects`
export const API_BASE_UPLOAD = `${API_BASE}/upload`
export const API_BASE_DOWNLOAD = `${API_BASE}/download`
export const API_BASE_SEARCH = `${API_BASE}/search`
export const API_BASE_MEMORIES = `${API_BASE}/memories`
export const API_BASE_CONNECTORS = `${API_BASE}/connectors`

export const PAGE_SIZE = 20
export const DOCS_PAGE_SIZE = 10
export const SEARCH_PAGE_SIZE = 10

// Cookie sessions: always send credentials with API calls.
axios.defaults.withCredentials = true

/**
 * Headers for authenticated API requests.
 * Auth is cookie-based (Better Auth session); no Bearer token.
 * Kept so call sites that spread authHeaders() continue to work.
 */
export function authHeaders(): Record<string, string> {
  return {}
}

export function getErrorMessage(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    const msg = e.response?.data?.message
    if (typeof msg === "string" && msg) return msg
    return e.message || fallback
  }
  if (e instanceof Error && e.message) return e.message
  return fallback
}
