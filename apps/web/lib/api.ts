import axios from "axios"

export const API_BASE = "http://localhost:3000/api/v1"
export const API_BASE_AUTH = `${API_BASE}/auth`
export const API_BASE_CHAT = `${API_BASE}/chat`
export const API_BASE_PROJECTS = `${API_BASE}/projects`
export const API_BASE_UPLOAD = `${API_BASE}/upload`
export const API_BASE_DOWNLOAD = `${API_BASE}/download`
export const API_BASE_SEARCH = `${API_BASE}/search`

export const PAGE_SIZE = 20
export const DOCS_PAGE_SIZE = 10
export const SEARCH_PAGE_SIZE = 10

export function authHeaders() {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null
  return { Authorization: "Bearer " + token }
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
