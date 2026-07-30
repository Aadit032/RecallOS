import type { ChatListItem, ChatSession } from "./types"

export {
  API_BASE,
  API_BASE_CHAT,
  API_BASE_PROJECTS,
  API_BASE_UPLOAD,
  PAGE_SIZE,
  authHeaders,
} from "@/lib/api"

export const DRAFT_ID = "__draft__"

export function isWebSearchDraft(text: string): boolean {
  return /^\/web(\s|$)/i.test(text.trimStart())
}

/** Multi-hop RAG over library: `/agent …` */
export function isAgentDraft(text: string): boolean {
  return /^\/agent(\s|$)/i.test(text.trimStart())
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
