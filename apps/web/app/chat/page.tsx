"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import axios from "axios"
import {
  FileText,
  Loader2,
  Mic,
  MicOff,
  Paperclip,
  Pin,
  PinOff,
  Plus,
  Search,
  Send,
  SquarePen,
} from "lucide-react"

import { ThemeToggle } from "@/components/theme-toggle"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const API_BASE_CHAT = "http://localhost:3000/api/v1/chat"
const PAGE_SIZE = 20

type Role = "user" | "assistant"

type Message = {
  id: string
  role: Role
  content: string
  createdAt: string
}

type ChatSession = {
  id: string
  title: string
  pinned: boolean
  updatedAt: string
  messageCount: number
  messages: Message[]
  messagesLoaded: boolean
}

type ChatListItem = {
  id: string
  title: string
  pinned: boolean
  updatedAt: string
  messageCount: number
}

/** Local draft before the first message creates a DB session. */
const DRAFT_ID = "__draft__"

function authHeaders() {
  const token = localStorage.getItem("token")
  return { Authorization: "Bearer " + token }
}

function formatChatTime(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
}

function emptyDraft(): ChatSession {
  return {
    id: DRAFT_ID,
    title: "New chat",
    pinned: false,
    updatedAt: new Date().toISOString(),
    messageCount: 0,
    messages: [],
    messagesLoaded: true,
  }
}

function mapListItem(c: ChatListItem): ChatSession {
  return {
    id: c.id,
    title: c.title,
    pinned: c.pinned,
    updatedAt:
      typeof c.updatedAt === "string"
        ? c.updatedAt
        : new Date(c.updatedAt).toISOString(),
    messageCount: c.messageCount ?? 0,
    messages: [],
    messagesLoaded: false,
  }
}

export default function ChatPage() {
  const [sessions, setSessions] = useState<ChatSession[]>([emptyDraft()])
  const [activeId, setActiveId] = useState(DRAFT_ID)
  const [query, setQuery] = useState("")
  const [draft, setDraft] = useState("")
  const [attachedName, setAttachedName] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const loadingMoreRef = useRef(false)

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0]

  const fetchChatPage = useCallback(async (cursor?: string | null) => {
    console.log(`[chat:fetchChatPage] Fetching chat list${cursor ? ` (cursor=${cursor})` : ""}`);
    const { data } = await axios.get(`${API_BASE_CHAT}/`, {
      headers: authHeaders(),
      params: {
        limit: PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      },
    })
    console.log(`[chat:fetchChatPage] Received ${data.chats?.length ?? 0} chats, hasMore=${data.hasMore}, nextCursor=${data.nextCursor ?? "none"}`);
    return data as {
      chats: ChatListItem[]
      nextCursor: string | null
      hasMore: boolean
    }
  }, [])

  const loadChats = useCallback(async () => {
    console.log(`[chat:loadChats] Loading chat list`);
    setLoading(true)
    setError("")
    try {
      const data = await fetchChatPage()
      const chats = (data.chats ?? []).map(mapListItem)

      setNextCursor(data.nextCursor ?? null)
      setHasMore(Boolean(data.hasMore))
      console.log(`[chat:loadChats] Fetched ${chats.length} chats, hasMore=${data.hasMore}`);

      setSessions((prev) => {
        // Preserve any in-memory sessions that already have loaded messages
        // (e.g. active thread) when remapping list metadata.
        const loadedById = new Map(
          prev
            .filter((s) => s.id !== DRAFT_ID && s.messagesLoaded)
            .map((s) => [s.id, s])
        )
        const merged = chats.map((c) => {
          const existing = loadedById.get(c.id)
          if (!existing) return c
          return {
            ...c,
            messages: existing.messages,
            messagesLoaded: true,
            messageCount: Math.max(c.messageCount, existing.messages.length),
          }
        })
        const draftSession = prev.find(
          (s) => s.id === DRAFT_ID && s.messages.length === 0
        )
        return draftSession ? [draftSession, ...merged] : [emptyDraft(), ...merged]
      })

      setActiveId((current) => {
        if (current === DRAFT_ID) return DRAFT_ID
        if (chats.some((c) => c.id === current)) return current
        return DRAFT_ID
      })
    } catch (e) {
      console.error(`[chat:loadChats] Error:`, e)
      setError("Could not load chats. Sign in and ensure the backend is running.")
    } finally {
      console.log(`[chat:loadChats] Done`);
      setLoading(false)
    }
  }, [fetchChatPage])

  const loadMoreChats = useCallback(async () => {
    if (!hasMore || !nextCursor || loadingMoreRef.current) {
      console.log(`[chat:loadMoreChats] Skipping — hasMore=${hasMore}, nextCursor=${nextCursor}, loading=${loadingMoreRef.current}`);
      return
    }
    console.log(`[chat:loadMoreChats] Loading more chats (cursor=${nextCursor})`);
    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      const data = await fetchChatPage(nextCursor)
      const chats = (data.chats ?? []).map(mapListItem)

      setNextCursor(data.nextCursor ?? null)
      setHasMore(Boolean(data.hasMore))
      console.log(`[chat:loadMoreChats] Loaded ${chats.length} more chats, hasMore=${data.hasMore}`);

      setSessions((prev) => {
        const existingIds = new Set(prev.map((s) => s.id))
        const fresh = chats.filter((c) => !existingIds.has(c.id))
        console.log(`[chat:loadMoreChats] ${fresh.length} new chats added`);
        return [...prev, ...fresh]
      })
    } catch (e) {
      console.error(`[chat:loadMoreChats] Error:`, e)
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [fetchChatPage, hasMore, nextCursor])

  const loadChatMessages = useCallback(async (chatId: string) => {
    if (chatId === DRAFT_ID) {
      console.log(`[chat:loadChatMessages] Skipping draft chat`);
      return
    }
    console.log(`[chat:loadChatMessages] Loading messages for chatId=${chatId}`);

    setLoadingMessages(true)
    try {
      const { data } = await axios.get(`${API_BASE_CHAT}/${chatId}`, {
        headers: authHeaders(),
      })
      const chat = data.chat as {
        id: string
        title: string
        pinned: boolean
        updatedAt: string
        messages: Message[]
      }

      const messages: Message[] = (chat.messages ?? []).map((m) => ({
        id: m.id,
        role: m.role as Role,
        content: m.content,
        createdAt:
          typeof m.createdAt === "string"
            ? m.createdAt
            : new Date(m.createdAt).toISOString(),
      }))

      console.log(`[chat:loadChatMessages] Fetched chat: "${chat.title}", ${messages.length} messages`);

      setSessions((prev) =>
        prev.map((s) =>
          s.id === chatId
            ? {
                ...s,
                title: chat.title,
                pinned: chat.pinned,
                updatedAt:
                  typeof chat.updatedAt === "string"
                    ? chat.updatedAt
                    : new Date(chat.updatedAt).toISOString(),
                messages,
                messageCount: messages.length,
                messagesLoaded: true,
              }
            : s
        )
      )
      console.log(`[chat:loadChatMessages] State updated for chatId=${chatId}`);
    } catch (e) {
      console.error(`[chat:loadChatMessages] Error for chatId=${chatId}:`, e)
      setError(
        axios.isAxiosError(e)
          ? (e.response?.data?.message as string) || e.message
          : "Failed to load chat messages"
      )
    } finally {
      setLoadingMessages(false)
    }
  }, [])

  useEffect(() => {
    void loadChats()
  }, [loadChats])

  // Fetch messages when selecting a chat that hasn't been loaded yet
  useEffect(() => {
    if (!activeId || activeId === DRAFT_ID) return
    const session = sessions.find((s) => s.id === activeId)
    if (!session || session.messagesLoaded) return
    void loadChatMessages(activeId)
  }, [activeId, sessions, loadChatMessages])

  // Infinite scroll for chat list
  useEffect(() => {
    const el = loadMoreRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadMoreChats()
        }
      },
      { root: el.closest('[data-sidebar="content"]') ?? null, rootMargin: "80px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMoreChats, sessions.length])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = sessions.filter((s) =>
      q ? s.title.toLowerCase().includes(q) : true
    )
    return [...list].sort((a, b) => {
      if (a.id === DRAFT_ID) return -1
      if (b.id === DRAFT_ID) return 1
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return +new Date(b.updatedAt) - +new Date(a.updatedAt)
    })
  }, [sessions, query])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [active?.messages.length, activeId, sending])

  const createChat = () => {
    setSessions((prev) => {
      const withoutEmptyDraft = prev.filter(
        (s) => !(s.id === DRAFT_ID && s.messages.length === 0)
      )
      return [emptyDraft(), ...withoutEmptyDraft]
    })
    setActiveId(DRAFT_ID)
    setDraft("")
    setAttachedName(null)
    setError("")
  }

  const selectChat = (id: string) => {
    setActiveId(id)
    setError("")
  }

  const togglePin = async (id: string) => {
    if (id === DRAFT_ID) return
    const session = sessions.find((s) => s.id === id)
    if (!session) return

    const nextPinned = !session.pinned
    console.log(`[chat:togglePin] Toggling pin for chatId=${id}: ${session.pinned} → ${nextPinned}`);
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, pinned: nextPinned } : s))
    )

    try {
      await axios.patch(
        `${API_BASE_CHAT}/${id}`,
        { pinned: nextPinned },
        { headers: authHeaders() }
      )
      console.log(`[chat:togglePin] Server confirmed pin=${nextPinned} for chatId=${id}`);
    } catch (e) {
      console.error(`[chat:togglePin] Error:`, e)
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, pinned: !nextPinned } : s))
      )
    }
  }

  const sendMessage = async () => {
    const text = draft.trim()
    if (!text || !active || sending) {
      console.log(`[chat:sendMessage] Skipping — text="${text}", active=${!!active}, sending=${sending}`);
      return
    }

    const content = attachedName ? `${text}\n\n📎 ${attachedName}` : text
    console.log(`[chat:sendMessage] Sending message: activeId="${active.id}", content="${content.slice(0, 120)}${content.length > 120 ? "…" : ""}"`);
    const tempUserId = `temp-user-${crypto.randomUUID()}`
    const optimisticUser: Message = {
      id: tempUserId,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    }

    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== active.id) return s
        return {
          ...s,
          title:
            s.title === "New chat" && s.messages.length === 0
              ? text.slice(0, 48) + (text.length > 48 ? "…" : "")
              : s.title,
          updatedAt: new Date().toISOString(),
          messages: [...s.messages, optimisticUser],
          messageCount: s.messageCount + 1,
          messagesLoaded: true,
        }
      })
    )
    setDraft("")
    setAttachedName(null)
    setSending(true)
    setError("")

    try {
      const body: { message: string; chatId?: string } = { message: content }
      if (active.id !== DRAFT_ID) body.chatId = active.id
      console.log(`[chat:sendMessage] POST /message — body.chatId=${body.chatId ?? "none (new session)"}`);

      const { data } = await axios.post(`${API_BASE_CHAT}/message`, body, {
        headers: authHeaders(),
      })
      console.log(`[chat:sendMessage] Response: chatId=${data.chatId}, isNewSession=${data.isNewSession}, sources=${data.sources?.length ?? 0}`);

      const chatId: string = data.chatId
      const userMsg: Message = {
        id: data.userMessage.id,
        role: "user",
        content: data.userMessage.content,
        createdAt: data.userMessage.createdAt,
      }
      const assistantMsg: Message = {
        id: data.assistantMessage.id,
        role: "assistant",
        content: data.assistantMessage.content,
        createdAt: data.assistantMessage.createdAt,
      }
      console.log(`[chat:sendMessage] Assistant response length: ${assistantMsg.content.length} chars`);

      setSessions((prev) => {
        const rest = prev.filter((s) => s.id !== active.id && s.id !== chatId)
        const prior =
          prev.find((s) => s.id === active.id) ??
          prev.find((s) => s.id === chatId)

        const priorWithoutTemp = (prior?.messages ?? []).filter(
          (m) => m.id !== tempUserId
        )
        const messages = [...priorWithoutTemp, userMsg, assistantMsg]

        const updated: ChatSession = {
          id: chatId,
          title: data.title ?? prior?.title ?? "Chat",
          pinned: prior?.pinned ?? false,
          updatedAt: new Date().toISOString(),
          messages,
          messageCount: messages.length,
          messagesLoaded: true,
        }

        const needsDraft = !rest.some((s) => s.id === DRAFT_ID)
        return needsDraft ? [emptyDraft(), updated, ...rest] : [updated, ...rest]
      })
      setActiveId(chatId)
    } catch (e) {
      console.error(`[chat:sendMessage] Error:`, e)
      setError(
        axios.isAxiosError(e)
          ? (e.response?.data?.message as string) || e.message
          : "Failed to send message"
      )
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== active.id) return s
          return {
            ...s,
            messages: s.messages.filter((m) => m.id !== tempUserId),
            messageCount: Math.max(0, s.messageCount - 1),
          }
        })
      )
      setDraft(text)
    } finally {
      setSending(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  }

  const showEmptyState =
    (!active || (active.messagesLoaded && active.messages.length === 0)) &&
    !sending &&
    !loadingMessages

  return (
    <SidebarProvider defaultOpen className="h-svh! min-h-0!">
      <Sidebar collapsible="offcanvas" className="border-r">
        <SidebarHeader className="gap-3 border-b border-sidebar-border p-3">
          <div className="flex items-center gap-2.5 px-1">
            <span className="font-display text-base font-medium tracking-tight">
              RecallOS
            </span>
          </div>
          <Button className="w-full justify-start gap-2 font-medium" onClick={createChat}>
            <SquarePen className="size-4" />
            New chat
          </Button>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats…"
              className="h-9 w-full rounded-md border border-sidebar-border bg-background pr-3 pl-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Chats</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {loading && sessions.length <= 1 && (
                  <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                    Loading chats…
                  </p>
                )}
                {filtered.length === 0 && !loading && (
                  <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                    No chats match your search.
                  </p>
                )}
                {filtered.map((session) => {
                  const selected = session.id === active?.id
                  return (
                    <SidebarMenuItem key={session.id}>
                      <SidebarMenuButton
                        isActive={selected}
                        onClick={() => selectChat(session.id)}
                        className="h-auto flex-col items-start gap-0.5 py-2"
                      >
                        <span className="flex w-full items-center gap-1.5">
                          {session.pinned && (
                            <Pin className="size-3 shrink-0 opacity-70" />
                          )}
                          <span className="truncate font-medium">
                            {session.title}
                          </span>
                        </span>
                        <span className="text-xs opacity-70">
                          {formatChatTime(session.updatedAt)} ·{" "}
                          {session.messageCount} messages
                        </span>
                      </SidebarMenuButton>
                      {session.id !== DRAFT_ID && (
                        <SidebarMenuAction
                          showOnHover
                          onClick={() => void togglePin(session.id)}
                          title={session.pinned ? "Unpin" : "Pin"}
                        >
                          {session.pinned ? (
                            <PinOff className="size-3.5" />
                          ) : (
                            <Pin className="size-3.5" />
                          )}
                        </SidebarMenuAction>
                      )}
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>

              {/* Sentinel for infinite scroll */}
              <div ref={loadMoreRef} className="h-1 w-full" />
              {loadingMore && (
                <p className="flex items-center justify-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Loading more…
                </p>
              )}
              {!hasMore && sessions.some((s) => s.id !== DRAFT_ID) && !loading && (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                  End of chats
                </p>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <SidebarInset className="min-h-0 overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/80 px-3 sm:px-4">
          <SidebarTrigger />
          <div className="min-w-0 flex-1">
            <h1 className="font-display truncate text-base font-medium tracking-tight sm:text-lg">
              {active?.title ?? "Chat"}
            </h1>
          </div>
          {active?.pinned && (
            <Badge variant="secondary" className="hidden gap-1 sm:inline-flex">
              <Pin className="size-3" />
              Pinned
            </Badge>
          )}
          <ThemeToggle />
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
            <Link href="/dashboard">Dashboard</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
            <Link href="/">Home</Link>
          </Button>
        </header>

        <div className="relative min-h-0 flex-1">
          <div ref={scrollRef} className="absolute inset-0 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pt-8 pb-28 sm:px-6 sm:pb-32">
              {error && (
                <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              {loadingMessages && (
                <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading conversation…
                </div>
              )}

              {showEmptyState && (
                <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
                  <p className="font-mono text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
                    Memory chat
                  </p>
                  <span className="font-display text-3xl font-medium tracking-tight sm:text-4xl">
                    Ask your{" "}
                    <span className="font-script text-foreground">memory</span>
                  </span>
                  <p className="max-w-md text-muted-foreground">
                    Query documents, notes, and organizational knowledge. A new
                    session is created when you send your first message.
                  </p>
                </div>
              )}

              {!loadingMessages &&
                active?.messages.map((message) =>
                  message.role === "user" ? (
                    <div key={message.id} className="flex w-full justify-end">
                      <div className="max-w-[85%] rounded-2xl bg-primary px-4 py-3 text-base leading-relaxed text-primary-foreground sm:max-w-[75%]">
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      </div>
                    </div>
                  ) : (
                    <div
                      key={message.id}
                      className="w-full space-y-2 text-base leading-7 text-foreground"
                    >
                      <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                        RecallOS
                      </p>
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    </div>
                  )
                )}

              {sending && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Searching memory and generating a reply…
                </div>
              )}
              <div ref={bottomRef} className="h-px w-full shrink-0" />
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-background via-background/95 to-transparent pt-5 pb-3">
            <div className="pointer-events-auto mx-auto w-full max-w-3xl px-4 sm:px-6">
              {attachedName && (
                <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <FileText className="size-3.5" />
                  <span className="truncate">{attachedName}</span>
                  <button
                    type="button"
                    className="font-medium text-foreground underline-offset-2 hover:underline"
                    onClick={() => setAttachedName(null)}
                  >
                    Remove
                  </button>
                </div>
              )}

              {listening && (
                <p className="mb-2 text-center text-xs font-medium text-muted-foreground">
                  Listening… (UI only)
                </p>
              )}

              <div className="memory-glow flex items-center gap-1 rounded-full border border-border/80 bg-background/90 p-1.5 backdrop-blur-sm focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30">
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,application/pdf,image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    setAttachedName(f?.name ?? null)
                    e.target.value = ""
                  }}
                />
                <div className="flex shrink-0 items-center gap-0.5 pl-0.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="rounded-full"
                        onClick={() => fileRef.current?.click()}
                        aria-label="Upload file"
                      >
                        <Plus className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Upload a file</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant={listening ? "secondary" : "ghost"}
                        size="icon-sm"
                        className="rounded-full"
                        onClick={() => setListening((v) => !v)}
                        aria-label={
                          listening ? "Stop microphone" : "Use microphone"
                        }
                      >
                        {listening ? (
                          <MicOff className="size-4" />
                        ) : (
                          <Mic className="size-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {listening ? "Stop listening" : "Voice input"}
                    </TooltipContent>
                  </Tooltip>
                </div>

                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Ask anything about your knowledge base…"
                  rows={1}
                  disabled={sending || loadingMessages}
                  className="max-h-32 min-h-9 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-base shadow-none focus-visible:border-transparent focus-visible:ring-0 md:text-sm"
                />

                <Button
                  type="button"
                  size="icon-sm"
                  className="mr-0.5 shrink-0 rounded-full"
                  disabled={!draft.trim() || sending || loadingMessages}
                  onClick={() => void sendMessage()}
                  aria-label="Send message"
                >
                  {sending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                </Button>
              </div>

              <p className="mt-1.5 text-center text-xs text-muted-foreground">
                <Paperclip className="mr-1 inline size-3" />
                Hybrid retrieval · RRF · cross-encoder · LLM
              </p>
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
