import type { ChatListItem, ChatSession } from "./types"

export const API_BASE = "http://localhost:3000/api/v1"
export const API_BASE_CHAT = `${API_BASE}/chat`
export const API_BASE_PROJECTS = `${API_BASE}/projects`
export const API_BASE_UPLOAD = `${API_BASE}/upload`
export const PAGE_SIZE = 20
export const DRAFT_ID = "__draft__"

export function isWebSearchDraft(text: string): boolean {
   return /^\/web(\s|$)/i.test(text.trimStart())
}

export function authHeaders() {
   const token = localStorage.getItem("token")
   return { Authorization: "Bearer " + token }
}

export function formatChatTime(iso: string) {
   return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
   })
}

export function emptyDraft(): ChatSession {
   return {
      id: DRAFT_ID,
      title: "New chat",
      pinned: false,
      projectId: null,
      projectName: null,
      updatedAt: new Date().toISOString(),
      messageCount: 0,
      messages: [],
      messagesLoaded: true,
   }
}

export function mapListItem(c: ChatListItem): ChatSession {
   return {
      id: c.id,
      title: c.title,
      pinned: c.pinned,
      projectId: c.projectId ?? null,
      projectName: c.projectName ?? null,
      updatedAt:
         typeof c.updatedAt === "string"
            ? c.updatedAt
            : new Date(c.updatedAt).toISOString(),
      messageCount: c.messageCount ?? 0,
      messages: [],
      messagesLoaded: false,
   }
}

export function sortSessions(a: ChatSession, b: ChatSession) {
   if (a.id === DRAFT_ID) return -1
   if (b.id === DRAFT_ID) return 1
   if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
   return +new Date(b.updatedAt) - +new Date(a.updatedAt)
}
