"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  Brain,
  FileText,
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
import { cn } from "@/lib/utils"

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
  messages: Message[]
}

const seedSessions: ChatSession[] = [
  {
    id: "chat-1",
    title: "Hybrid retrieval overview",
    pinned: true,
    updatedAt: "2026-07-09T14:20:00.000Z",
    messages: [
      {
        id: "m1",
        role: "user",
        content: "How does hybrid retrieval work in RecallOS?",
        createdAt: "2026-07-09T14:10:00.000Z",
      },
      {
        id: "m2",
        role: "assistant",
        content:
          "RecallOS runs BM25 (OpenSearch) and vector search (Qdrant) in parallel, then fuses the ranked lists with Reciprocal Rank Fusion and a cross-encoder reranker before sending the top chunks to the LLM.",
        createdAt: "2026-07-09T14:10:12.000Z",
      },
      {
        id: "m3",
        role: "user",
        content: "What gets stored for each chunk?",
        createdAt: "2026-07-09T14:11:00.000Z",
      },
      {
        id: "m4",
        role: "assistant",
        content:
          "Each chunk is enriched with a summary, section title, keywords, entities, page number, tags, document ID, and user ID — then embedded and indexed for both lexical and semantic retrieval.",
        createdAt: "2026-07-09T14:11:18.000Z",
      },
      {
        id: "m4b",
        role: "user",
        content: "And how does RRF decide the final ranking?",
        createdAt: "2026-07-09T14:12:00.000Z",
      },
      {
        id: "m4c",
        role: "assistant",
        content:
          "Reciprocal Rank Fusion scores each document by summing 1 / (k + rank) across both result lists. Items that rank well in either (or both) systems rise to the top, then the cross-encoder reorders the fused shortlist.",
        createdAt: "2026-07-09T14:12:20.000Z",
      },
    ],
  },
  {
    id: "chat-2",
    title: "Q3 roadmap notes",
    pinned: false,
    updatedAt: "2026-07-08T18:05:00.000Z",
    messages: [
      {
        id: "m5",
        role: "user",
        content: "Summarize the Q3 product notes from our knowledge base.",
        createdAt: "2026-07-08T18:00:00.000Z",
      },
      {
        id: "m6",
        role: "assistant",
        content:
          "Q3 focuses on agent workflows, better citations, and connectors. Ingestion remains async via Redis Streams; retrieval stays hybrid with stronger reranking.",
        createdAt: "2026-07-08T18:00:20.000Z",
      },
    ],
  },
  {
    id: "chat-3",
    title: "Upload pipeline debug",
    pinned: false,
    updatedAt: "2026-07-07T09:40:00.000Z",
    messages: [
      {
        id: "m7",
        role: "user",
        content: "Why would a document stay in QUEUED?",
        createdAt: "2026-07-07T09:35:00.000Z",
      },
      {
        id: "m8",
        role: "assistant",
        content:
          "Usually the worker isn't consuming the Redis stream, or LlamaParse failed before status was updated. Check worker logs and the document's status field in Postgres.",
        createdAt: "2026-07-07T09:35:25.000Z",
      },
    ],
  },
]

function formatChatTime(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
}

export default function ChatPage() {
  const [sessions, setSessions] = useState<ChatSession[]>(seedSessions)
  const [activeId, setActiveId] = useState(seedSessions[0]?.id ?? "")
  const [query, setQuery] = useState("")
  const [draft, setDraft] = useState("")
  const [attachedName, setAttachedName] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0]

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = sessions.filter((s) =>
      q ? s.title.toLowerCase().includes(q) : true
    )
    return [...list].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return +new Date(b.updatedAt) - +new Date(a.updatedAt)
    })
  }, [sessions, query])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [active?.messages.length, activeId])

  const createChat = () => {
    const id = `chat-${crypto.randomUUID().slice(0, 8)}`
    const session: ChatSession = {
      id,
      title: "New chat",
      pinned: false,
      updatedAt: new Date().toISOString(),
      messages: [],
    }
    setSessions((prev) => [session, ...prev])
    setActiveId(id)
    setDraft("")
    setAttachedName(null)
  }

  const togglePin = (id: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, pinned: !s.pinned } : s))
    )
  }

  const sendMessage = () => {
    const text = draft.trim()
    if (!text || !active) return

    const userMsg: Message = {
      id: `m-${crypto.randomUUID()}`,
      role: "user",
      content: attachedName ? `${text}\n\n📎 ${attachedName}` : text,
      createdAt: new Date().toISOString(),
    }

    const assistantMsg: Message = {
      id: `m-${crypto.randomUUID()}`,
      role: "assistant",
      content:
        "Got it — I'll search your organizational memory for relevant chunks and reply with citations once the live chat API is connected. (Seeded UI response.)",
      createdAt: new Date().toISOString(),
    }

    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== active.id) return s
        const title =
          s.title === "New chat" && s.messages.length === 0
            ? text.slice(0, 48) + (text.length > 48 ? "…" : "")
            : s.title
        return {
          ...s,
          title,
          updatedAt: new Date().toISOString(),
          messages: [...s.messages, userMsg, assistantMsg],
        }
      })
    )
    setDraft("")
    setAttachedName(null)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <SidebarProvider defaultOpen className="h-svh! min-h-0!">
      <Sidebar collapsible="offcanvas" className="border-r">
        <SidebarHeader className="gap-3 border-b border-sidebar-border p-3">
          <div className="flex items-center gap-2 px-1">
            <span className="flex size-7 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
              <Brain className="size-4" />
            </span>
            <span className="font-semibold tracking-tight">RecallOS</span>
          </div>
          <Button className="w-full justify-start gap-2" onClick={createChat}>
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
                {filtered.length === 0 && (
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
                        onClick={() => setActiveId(session.id)}
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
                          {session.messages.length} messages
                        </span>
                      </SidebarMenuButton>
                      <SidebarMenuAction
                        showOnHover
                        onClick={() => togglePin(session.id)}
                        title={session.pinned ? "Unpin" : "Pin"}
                      >
                        {session.pinned ? (
                          <PinOff className="size-3.5" />
                        ) : (
                          <Pin className="size-3.5" />
                        )}
                      </SidebarMenuAction>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <SidebarInset className="min-h-0 overflow-hidden">
        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
          <SidebarTrigger />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">
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

        {/* Messages + floating composer */}
        <div className="relative min-h-0 flex-1">
          {/* Scrollable thread — padding leaves room under the floating input */}
          <div
            ref={scrollRef}
            className="absolute inset-0 overflow-y-auto"
          >
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-8 pb-44 sm:px-6 sm:pb-48">
              {(!active || active.messages.length === 0) && (
                <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
                  <span className="text-3xl font-semibold tracking-tight sm:text-4xl">
                    Ask your memory
                  </span>
                  <p className="max-w-md text-muted-foreground">
                    Query documents, notes, and organizational knowledge. Answers
                    will cite the chunks they came from.
                  </p>
                </div>
              )}

              {active?.messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "flex w-full",
                    message.role === "user" ? "justify-end" : "justify-start"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-4 py-3 text-base leading-relaxed sm:max-w-[75%]",
                      message.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground"
                    )}
                  >
                    <p className="mb-1 text-xs font-semibold opacity-70">
                      {message.role === "user" ? "You" : "RecallOS"}
                    </p>
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} className="h-px w-full shrink-0" />
            </div>
          </div>

          {/* Composer floats over the scroll area so messages pass under it */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-background via-background/95 to-transparent pt-10">
            <div className="pointer-events-auto mx-auto w-full max-w-3xl px-4 pb-4 sm:px-6 sm:pb-6">
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

              <div className="rounded-2xl border bg-background/90 p-2 shadow-lg backdrop-blur-sm focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Ask anything about your knowledge base…"
                  rows={1}
                  className="min-h-[48px] max-h-40 resize-none border-0 bg-transparent px-3 py-2 shadow-none focus-visible:ring-0 md:text-base"
                />

                <div className="flex items-center justify-between gap-2 px-1 pt-1">
                  <div className="flex items-center gap-1">
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
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
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
                          size="icon"
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

                    {listening && (
                      <span className="text-xs font-medium text-muted-foreground">
                        Listening… (UI only)
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="hidden text-xs text-muted-foreground sm:inline">
                      Enter to send
                    </span>
                    <Button
                      type="button"
                      size="icon"
                      disabled={!draft.trim()}
                      onClick={sendMessage}
                      aria-label="Send message"
                    >
                      <Send className="size-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <p className="mt-2 text-center text-xs text-muted-foreground">
                <Paperclip className="mr-1 inline size-3" />
                Chat is UI-seeded for now — retrieval will plug in next.
              </p>
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
