"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import axios from "axios"
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
  Loader2,
  Mic,
  MicOff,
  MoreHorizontal,
  Paperclip,
  Pin,
  PinOff,
  Plus,
  Search,
  Send,
  Settings2,
  SquarePen,
  Trash2,
} from "lucide-react"

import { ThemeToggle } from "@/components/theme-toggle"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
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
const API_BASE_PROJECTS = "http://localhost:3000/api/v1/projects"
const PAGE_SIZE = 20

type Role = "user" | "assistant"

type Message = {
  id: string
  role: Role
  content: string
  createdAt: string
}

type Project = {
  id: string
  name: string
  systemPrompt: string | null
  chatCount?: number
}

type ChatSession = {
  id: string
  title: string
  pinned: boolean
  projectId: string | null
  projectName: string | null
  updatedAt: string
  messageCount: number
  messages: Message[]
  messagesLoaded: boolean
}

type ChatListItem = {
  id: string
  title: string
  pinned: boolean
  projectId?: string | null
  projectName?: string | null
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
    projectId: null,
    projectName: null,
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
  const [projects, setProjects] = useState<Project[]>([])
  const [showChats, setShowChats] = useState(true)
  const [showProjects, setShowProjects] = useState(true)
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(new Set())
  const [showCreateInput, setShowCreateInput] = useState(false)
  const [newProjectName, setNewProjectName] = useState("")
  const [creatingProject, setCreatingProject] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [editProjectName, setEditProjectName] = useState("")
  const [editProjectPrompt, setEditProjectPrompt] = useState("")
  const [savingProject, setSavingProject] = useState(false)
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

  const loadProjects = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_BASE_PROJECTS}/`, {
        headers: authHeaders(),
      })
      setProjects(
        (data.projects ?? []).map((p: Project) => ({
          id: p.id,
          name: p.name,
          systemPrompt: p.systemPrompt ?? null,
          chatCount: p.chatCount,
        }))
      )
    } catch (e) {
      console.error(`[chat:loadProjects] Error:`, e)
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
        projectId?: string | null
        updatedAt: string
        messages: Message[]
        project?: { id: string; name: string } | null
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
                projectId: chat.projectId ?? chat.project?.id ?? null,
                projectName: chat.project?.name ?? s.projectName,
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
    void loadProjects()
  }, [loadChats, loadProjects])

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

  const sortSessions = (a: ChatSession, b: ChatSession) => {
    if (a.id === DRAFT_ID) return -1
    if (b.id === DRAFT_ID) return 1
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return +new Date(b.updatedAt) - +new Date(a.updatedAt)
  }

  const unfiledChats = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sessions
      .filter((s) => !s.projectId && (q ? s.title.toLowerCase().includes(q) : true))
      .sort(sortSessions)
  }, [sessions, query])

  const projectChatsMap = useMemo(() => {
    const q = query.trim().toLowerCase()
    const map = new Map<string, ChatSession[]>()
    for (const s of sessions) {
      if (!s.projectId) continue
      if (q && !s.title.toLowerCase().includes(q)) continue
      const arr = map.get(s.projectId) ?? []
      arr.push(s)
      map.set(s.projectId, arr)
    }
    for (const arr of map.values()) arr.sort(sortSessions)
    return map
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

  const deleteChat = async (id: string) => {
    if (id === DRAFT_ID) return
    const session = sessions.find((s) => s.id === id)
    if (!session) return

    const confirmed = window.confirm(`Delete “${session.title}”? This cannot be undone.`)
    if (!confirmed) return

    const snapshot = sessions
    setSessions((prev) => prev.filter((s) => s.id !== id))
    if (activeId === id) {
      setActiveId(DRAFT_ID)
    }

    try {
      await axios.delete(`${API_BASE_CHAT}/${id}`, { headers: authHeaders() })
      console.log(`[chat:deleteChat] Deleted chatId=${id}`)
    } catch (e) {
      console.error(`[chat:deleteChat] Error:`, e)
      setSessions(snapshot)
      setError(
        axios.isAxiosError(e)
          ? (e.response?.data?.message as string) || e.message
          : "Failed to delete chat"
      )
    }
  }

  const moveToProject = async (chatId: string, projectId: string | null) => {
    if (chatId === DRAFT_ID) return
    const projectName =
      projectId == null
        ? null
        : projects.find((p) => p.id === projectId)?.name ?? null

    setSessions((prev) =>
      prev.map((s) =>
        s.id === chatId
          ? { ...s, projectId, projectName }
          : s
      )
    )

    try {
      await axios.patch(
        `${API_BASE_CHAT}/${chatId}`,
        { projectId },
        { headers: authHeaders() }
      )
      console.log(`[chat:moveToProject] chatId=${chatId} → projectId=${projectId ?? "none"}`)
      void loadProjects()
    } catch (e) {
      console.error(`[chat:moveToProject] Error:`, e)
      setError(
        axios.isAxiosError(e)
          ? (e.response?.data?.message as string) || e.message
          : "Failed to move chat"
      )
      void loadChats()
    }
  }

  const createProject = async () => {
    const name = newProjectName.trim()
    if (!name || creatingProject) return
    setCreatingProject(true)
    try {
      const { data } = await axios.post(
        `${API_BASE_PROJECTS}/`,
        { name },
        { headers: authHeaders() }
      )
      const project = data.project as Project
      setProjects((prev) => [
        {
          id: project.id,
          name: project.name,
          systemPrompt: project.systemPrompt ?? null,
          chatCount: 0,
        },
        ...prev,
      ])
      setNewProjectName("")
    } catch (e) {
      console.error(`[chat:createProject] Error:`, e)
      setError(
        axios.isAxiosError(e)
          ? (e.response?.data?.message as string) || e.message
          : "Failed to create project"
      )
    } finally {
      setCreatingProject(false)
    }
  }

  const openEditProject = (project: Project) => {
    setEditingProject(project)
    setEditProjectName(project.name)
    setEditProjectPrompt(project.systemPrompt ?? "")
  }

  const saveProject = async () => {
    if (!editingProject || savingProject) return
    const name = editProjectName.trim()
    if (!name) return
    setSavingProject(true)
    try {
      const { data } = await axios.patch(
        `${API_BASE_PROJECTS}/${editingProject.id}`,
        {
          name,
          systemPrompt: editProjectPrompt.trim() || null,
        },
        { headers: authHeaders() }
      )
      const updated = data.project as Project
      setProjects((prev) =>
        prev.map((p) =>
          p.id === updated.id
            ? {
                ...p,
                name: updated.name,
                systemPrompt: updated.systemPrompt ?? null,
              }
            : p
        )
      )
      setSessions((prev) =>
        prev.map((s) =>
          s.projectId === updated.id
            ? { ...s, projectName: updated.name }
            : s
        )
      )
      setEditingProject(null)
    } catch (e) {
      console.error(`[chat:saveProject] Error:`, e)
      setError(
        axios.isAxiosError(e)
          ? (e.response?.data?.message as string) || e.message
          : "Failed to update project"
      )
    } finally {
      setSavingProject(false)
    }
  }

  const deleteProject = async (projectId: string) => {
    const project = projects.find((p) => p.id === projectId)
    if (!project) return
    const confirmed = window.confirm(
      `Delete project “${project.name}”? Chats will be unfiled, not deleted.`
    )
    if (!confirmed) return

    try {
      await axios.delete(`${API_BASE_PROJECTS}/${projectId}`, {
        headers: authHeaders(),
      })
      setProjects((prev) => prev.filter((p) => p.id !== projectId))
      setSessions((prev) =>
        prev.map((s) =>
          s.projectId === projectId
            ? { ...s, projectId: null, projectName: null }
            : s
        )
      )
      if (editingProject?.id === projectId) setEditingProject(null)
    } catch (e) {
      console.error(`[chat:deleteProject] Error:`, e)
      setError(
        axios.isAxiosError(e)
          ? (e.response?.data?.message as string) || e.message
          : "Failed to delete project"
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
          projectId: prior?.projectId ?? null,
          projectName: prior?.projectName ?? null,
          updatedAt: new Date().toISOString(),
          messages,
          messageCount: messages.length,
          messagesLoaded: true,
        }

        const needsDraft = !rest.some((s) => s.id === DRAFT_ID)
        // Keep draft first, then re-sort: pinned chats float to top
        const withUpdated = needsDraft
          ? [emptyDraft(), updated, ...rest]
          : [updated, ...rest]
        return withUpdated
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
            <SidebarGroupLabel asChild>
              <button
                onClick={() => setShowProjects(!showProjects)}
                className="flex w-full cursor-pointer items-center gap-1.5"
              >
                <span className="">Projects</span>
                {showProjects ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                <span className="text-[10px] opacity-60">{projects.length}</span>
                <span
                  className="ml-auto flex size-3.5 items-center justify-center rounded opacity-60 hover:opacity-100"
                  title={showCreateInput ? "Close" : "New project"}
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowCreateInput((v) => !v)
                  }}
                >
                  <Plus className="size-3" />
                </span>
              </button>
            </SidebarGroupLabel>
            {showProjects && (
              <SidebarGroupContent>
                {showCreateInput && (
                  <div className="mb-2 flex gap-1.5 px-1">
                    <input
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          void createProject()
                        }
                      }}
                      placeholder="New project…"
                      className="h-8 min-w-0 flex-1 rounded-md border border-sidebar-border bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 shrink-0 px-2"
                      disabled={!newProjectName.trim() || creatingProject}
                      onClick={() => {
                        void createProject()
                        setShowCreateInput(false)
                      }}
                      title="Create project"
                    >
                      {creatingProject ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <FolderPlus className="size-3.5" />
                      )}
                    </Button>
                  </div>
                )}
                {projects.length === 0 ? (
                  <p className="px-2 py-2 text-xs text-muted-foreground">
                    No projects yet. Create one to organize chats and set a project system prompt.
                  </p>
                ) : (
                  <SidebarMenu>
                    {projects.map((project) => {
                      const expanded = expandedProjectIds.has(project.id)
                      const projectChats = projectChatsMap.get(project.id) ?? []
                      return (
                        <Fragment key={project.id}>
                          <SidebarMenuItem>
                            <SidebarMenuButton
                              className="h-auto items-center gap-2 py-1.5"
                              onClick={() =>
                                setExpandedProjectIds((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(project.id))
                                    next.delete(project.id)
                                  else next.add(project.id)
                                  return next
                                })
                              }
                            >
                              <Folder className="size-3.5 shrink-0 opacity-70" />
                              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                                {project.name}
                              </span>
                              {expanded ? (
                                <ChevronDown className="size-3 shrink-0 opacity-70" />
                              ) : (
                                <ChevronRight className="size-3 shrink-0 opacity-70" />
                              )}
                              {typeof project.chatCount === "number" && (
                                <span className="text-[10px] opacity-60">
                                  {project.chatCount}
                                </span>
                              )}
                            </SidebarMenuButton>
                            <SidebarMenuAction
                              showOnHover
                              title="Edit project"
                              onClick={() => openEditProject(project)}
                            >
                              <Settings2 className="size-3.5" />
                            </SidebarMenuAction>
                          </SidebarMenuItem>
                          {expanded &&
                            projectChats.map((chat) => (
                              <SidebarMenuItem key={chat.id} className="pl-8">
                                <SidebarMenuButton
                                  isActive={chat.id === active?.id}
                                  onClick={() => selectChat(chat.id)}
                                  className="h-auto py-1.5"
                                >
                                  <span className="truncate text-sm">
                                    {chat.title}
                                  </span>
                                </SidebarMenuButton>
                                <SidebarMenuAction
                                  showOnHover
                                  title="Remove from project"
                                  onClick={() =>
                                    void moveToProject(chat.id, null)
                                  }
                                >
                                  <FolderInput className="size-3.5" />
                                </SidebarMenuAction>
                              </SidebarMenuItem>
                            ))}
                        </Fragment>
                      )
                    })}
                  </SidebarMenu>
                )}
                {editingProject && (
                  <div className="mt-2 space-y-2 rounded-md border border-sidebar-border bg-background/80 p-2">
                    <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                      Edit project
                    </p>
                    <input
                      value={editProjectName}
                      onChange={(e) => setEditProjectName(e.target.value)}
                      className="h-8 w-full rounded-md border border-sidebar-border bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      placeholder="Project name"
                    />
                    <textarea
                      value={editProjectPrompt}
                      onChange={(e) => setEditProjectPrompt(e.target.value)}
                      rows={3}
                      placeholder="Extra system prompt for chats in this project…"
                      className="w-full resize-y rounded-md border border-sidebar-border bg-background px-2 py-1.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={savingProject || !editProjectName.trim()}
                        onClick={() => void saveProject()}
                      >
                        {savingProject ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          "Save"
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => setEditingProject(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                        onClick={() => void deleteProject(editingProject.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                )}
              </SidebarGroupContent>
            )}
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel asChild>
              <button
                onClick={() => setShowChats(!showChats)}
                className="flex w-full cursor-pointer items-center gap-1.5"
              >
                <span>Chats</span>
                {showChats ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                <span className="ml-auto text-[10px] opacity-60">
                  {unfiledChats.length}
                </span>
              </button>
            </SidebarGroupLabel>
            {showChats && (
              <SidebarGroupContent>
              <SidebarMenu>
                {loading && sessions.length <= 1 && (
                  <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                    Loading chats…
                  </p>
                )}
                {unfiledChats.length === 0 && !loading && (
                  <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                    No chats match your search.
                  </p>
                )}
                {unfiledChats.map((session) => {
                  const selected = session.id === active?.id
                  return (
                    <SidebarMenuItem key={session.id}>
                      <SidebarMenuButton
                        isActive={selected}
                        onClick={() => selectChat(session.id)}
                        className="h-auto flex-col items-start gap-0.5 py-2 pr-8"
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
                          {session.projectName
                            ? ` · ${session.projectName}`
                            : ""}
                        </span>
                      </SidebarMenuButton>
                      {session.id !== DRAFT_ID && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <SidebarMenuAction
                              showOnHover
                              title="More"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreHorizontal className="size-3.5" />
                            </SidebarMenuAction>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            side="right"
                            align="start"
                            className="w-48"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <DropdownMenuItem
                              onClick={() => void togglePin(session.id)}
                            >
                              {session.pinned ? (
                                <>
                                  <PinOff className="size-3.5" />
                                  Unpin
                                </>
                              ) : (
                                <>
                                  <Pin className="size-3.5" />
                                  Pin
                                </>
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger>
                                <FolderInput className="size-3.5" />
                                Move to project
                              </DropdownMenuSubTrigger>
                              <DropdownMenuSubContent className="w-48">
                                <DropdownMenuItem
                                  onClick={() =>
                                    void moveToProject(session.id, null)
                                  }
                                >
                                  {!session.projectId && (
                                    <Check className="size-3.5" />
                                  )}
                                  <span
                                    className={
                                      session.projectId ? "pl-5" : undefined
                                    }
                                  >
                                    No project
                                  </span>
                                </DropdownMenuItem>
                                {projects.length > 0 && (
                                  <DropdownMenuSeparator />
                                )}
                                {projects.map((project) => (
                                  <DropdownMenuItem
                                    key={project.id}
                                    onClick={() =>
                                      void moveToProject(
                                        session.id,
                                        project.id
                                      )
                                    }
                                  >
                                    {session.projectId === project.id && (
                                      <Check className="size-3.5" />
                                    )}
                                    <span
                                      className={
                                        session.projectId === project.id
                                          ? undefined
                                          : "pl-5"
                                      }
                                    >
                                      {project.name}
                                    </span>
                                  </DropdownMenuItem>
                                ))}
                                {projects.length === 0 && (
                                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                                    Create a project first
                                  </DropdownMenuLabel>
                                )}
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => void deleteChat(session.id)}
                            >
                              <Trash2 className="size-3.5" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
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
            )}
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
          {active?.projectName && (
            <Badge variant="outline" className="hidden gap-1 sm:inline-flex">
              <Folder className="size-3" />
              {active.projectName}
            </Badge>
          )}
          {active && active.id !== DRAFT_ID && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              title="Delete chat"
              onClick={() => void deleteChat(active.id)}
            >
              <Trash2 className="size-4" />
              <span className="hidden sm:inline">Delete</span>
            </Button>
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
