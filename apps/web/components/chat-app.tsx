"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import axios from "axios"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
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
  PanelLeft,
  Paperclip,
  Pin,
  PinOff,
  Plus,
  Search,
  Send,
  Settings2,
  SquarePen,
  Trash2,
  User,
} from "lucide-react"

import { ThemeToggle } from "@/components/theme-toggle"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { Input } from "@/components/ui/input"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
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

import "katex/dist/katex.min.css"

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

function MarkdownContent({ content }: { content: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        pre: ({ children }) => (
          <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 text-xs">
            {children}
          </pre>
        ),
        code: ({ className, children, ...props }) => {
          const isBlock = className?.startsWith("language-")
          if (isBlock) {
            return (
              <code className={className} {...props}>
                {children}
              </code>
            )
          }
          return (
            <code
              className="rounded bg-muted/50 px-1.5 py-0.5 text-xs"
              {...props}
            >
              {children}
            </code>
          )
        },
        ul: ({ children }) => (
          <ul className="mb-2 list-inside list-disc space-y-1">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-2 list-inside list-decimal space-y-1">
            {children}
          </ol>
        ),
        li: ({ children }) => <li>{children}</li>,
        h1: ({ children }) => (
          <h1 className="mb-2 text-lg font-semibold">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="mb-2 text-base font-semibold">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="mb-1 text-sm font-semibold">{children}</h3>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-muted-foreground/30 pl-3 italic text-muted-foreground">
            {children}
          </blockquote>
        ),
        table: ({ children }) => (
          <div className="mb-2 overflow-x-auto">
            <table className="w-full text-sm">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border-b border-border px-2 py-1 text-left font-medium">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border-b border-border px-2 py-1">{children}</td>
        ),
        a: ({ children, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline-offset-2 hover:underline"
          >
            {children}
          </a>
        ),
        hr: () => <hr className="my-3 border-border" />,
      }}
    >
      {content}
    </Markdown>
  )
}

function ExpandableMessage({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  const needsTruncate = content.length > 300
  const display = expanded || !needsTruncate ? content : content.slice(0, 300) + "…"

  return (
    <div>
      <p className="whitespace-pre-wrap">{display}</p>
      {needsTruncate && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-xs font-medium text-primary/80 hover:text-primary"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  )
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
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(
    new Set()
  )
  const [creatingProject, setCreatingProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState("")
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [editProjectName, setEditProjectName] = useState("")
  const [editProjectPrompt, setEditProjectPrompt] = useState("")
  const [savingProject, setSavingProject] = useState(false)

  // Modal states
  const [showCreateProjectModal, setShowCreateProjectModal] = useState(false)
  const [showEditProjectModal, setShowEditProjectModal] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{
    type: "chat" | "project"
    id: string
    name: string
  } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const loadingMoreRef = useRef(false)

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0]

  const fetchChatPage = useCallback(async (cursor?: string | null) => {
    const { data } = await axios.get(`${API_BASE_CHAT}/`, {
      headers: authHeaders(),
      params: {
        limit: PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      },
    })
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
      console.error("[chat:loadProjects]", e)
    }
  }, [])

  const loadChats = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const data = await fetchChatPage()
      const chats = (data.chats ?? []).map(mapListItem)

      setNextCursor(data.nextCursor ?? null)
      setHasMore(Boolean(data.hasMore))

      setSessions((prev) => {
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
        return draftSession
          ? [draftSession, ...merged]
          : [emptyDraft(), ...merged]
      })

      setActiveId((current) => {
        if (current === DRAFT_ID) return DRAFT_ID
        if (chats.some((c) => c.id === current)) return current
        return DRAFT_ID
      })
    } catch {
      setError(
        "Could not load chats. Sign in and ensure the backend is running."
      )
    } finally {
      setLoading(false)
    }
  }, [fetchChatPage])

  const loadMoreChats = useCallback(async () => {
    if (!hasMore || !nextCursor || loadingMoreRef.current) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      const data = await fetchChatPage(nextCursor)
      const chats = (data.chats ?? []).map(mapListItem)

      setNextCursor(data.nextCursor ?? null)
      setHasMore(Boolean(data.hasMore))

      setSessions((prev) => {
        const existingIds = new Set(prev.map((s) => s.id))
        const fresh = chats.filter((c) => !existingIds.has(c.id))
        return [...prev, ...fresh]
      })
    } catch (e) {
      console.error("[chat:loadMoreChats]", e)
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [fetchChatPage, hasMore, nextCursor])

  const loadChatMessages = useCallback(async (chatId: string) => {
    if (chatId === DRAFT_ID) return
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
    } catch (e) {
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

  useEffect(() => {
    if (!activeId || activeId === DRAFT_ID) return
    const session = sessions.find((s) => s.id === activeId)
    if (!session || session.messagesLoaded) return
    void loadChatMessages(activeId)
  }, [activeId, sessions, loadChatMessages])

  useEffect(() => {
    const el = loadMoreRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMoreChats()
      },
      {
        root: el.closest('[data-sidebar="content"]') ?? null,
        rootMargin: "80px",
      }
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
      .filter(
        (s) => !s.projectId && (q ? s.title.toLowerCase().includes(q) : true)
      )
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
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, pinned: nextPinned } : s))
    )
    try {
      await axios.patch(
        `${API_BASE_CHAT}/${id}`,
        { pinned: nextPinned },
        { headers: authHeaders() }
      )
    } catch {
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, pinned: !nextPinned } : s))
      )
    }
  }

  const deleteChat = async (id: string) => {
    if (id === DRAFT_ID) return
    const snapshot = sessions
    setSessions((prev) => prev.filter((s) => s.id !== id))
    if (activeId === id) setActiveId(DRAFT_ID)
    try {
      await axios.delete(`${API_BASE_CHAT}/${id}`, { headers: authHeaders() })
    } catch {
      setSessions(snapshot)
      setError("Failed to delete chat")
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
        s.id === chatId ? { ...s, projectId, projectName } : s
      )
    )
    try {
      await axios.patch(
        `${API_BASE_CHAT}/${chatId}`,
        { projectId },
        { headers: authHeaders() }
      )
      void loadProjects()
    } catch {
      setError("Failed to move chat")
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
      setShowCreateProjectModal(false)
    } catch {
      setError("Failed to create project")
    } finally {
      setCreatingProject(false)
    }
  }

  const openEditProject = (project: Project) => {
    setEditingProject(project)
    setEditProjectName(project.name)
    setEditProjectPrompt(project.systemPrompt ?? "")
    setShowEditProjectModal(true)
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
      setShowEditProjectModal(false)
      setEditingProject(null)
    } catch {
      setError("Failed to update project")
    } finally {
      setSavingProject(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      if (deleteTarget.type === "chat") {
        await deleteChat(deleteTarget.id)
      } else {
        await axios.delete(`${API_BASE_PROJECTS}/${deleteTarget.id}`, {
          headers: authHeaders(),
        })
        setProjects((prev) => prev.filter((p) => p.id !== deleteTarget.id))
        setSessions((prev) =>
          prev.map((s) =>
            s.projectId === deleteTarget.id
              ? { ...s, projectId: null, projectName: null }
              : s
          )
        )
        if (editingProject?.id === deleteTarget.id) {
          setShowEditProjectModal(false)
          setEditingProject(null)
        }
      }
    } catch {
      setError(
        `Failed to delete ${deleteTarget.type === "chat" ? "chat" : "project"}`
      )
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  const sendMessage = async () => {
    const text = draft.trim()
    if (!text || !active || sending) return

    const content = attachedName ? `${text}\n\n📎 ${attachedName}` : text
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

      const { data } = await axios.post(`${API_BASE_CHAT}/message`, body, {
        headers: authHeaders(),
      })

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
        const withUpdated = needsDraft
          ? [emptyDraft(), updated, ...rest]
          : [updated, ...rest]
        return withUpdated
      })
      setActiveId(chatId)
    } catch (e) {
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
      <Sidebar collapsible="icon" className="border-r">
        <SidebarHeader className="gap-2 border-b border-sidebar-border p-2">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <span className="font-display text-base font-medium tracking-tight truncate group-data-[collapsible=icon]:hidden">
              RecallOS
            </span>
          </div>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={createChat}
                tooltip="New chat"
              >
                <SquarePen className="size-4" />
                <span className="truncate group-data-[collapsible=icon]:hidden">
                  New chat
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <div className="relative group-data-[collapsible=icon]:hidden">
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
                <Folder className="size-4 shrink-0" />
                <span className="truncate group-data-[collapsible=icon]:hidden">
                  Projects
                </span>
                {showProjects ? (
                  <ChevronDown className="size-3 group-data-[collapsible=icon]:hidden" />
                ) : (
                  <ChevronRight className="size-3 group-data-[collapsible=icon]:hidden" />
                )}
                <span className="text-[10px] opacity-60 group-data-[collapsible=icon]:hidden">
                  {projects.length}
                </span>
                <span
                  className="ml-auto flex size-3.5 items-center justify-center rounded opacity-60 hover:opacity-100 group-data-[collapsible=icon]:hidden"
                  title="New project"
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowCreateProjectModal(true)
                  }}
                >
                  <Plus className="size-3" />
                </span>
              </button>
            </SidebarGroupLabel>
            {showProjects && (
              <SidebarGroupContent className="animate-sidebar-section">
                {projects.length === 0 ? (
                  <p className="px-2 py-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                    No projects yet.
                  </p>
                ) : (
                  <SidebarMenu>
                    {projects.map((project) => {
                      const expanded = expandedProjectIds.has(project.id)
                      const projectChats =
                        projectChatsMap.get(project.id) ?? []
                      return (
                        <Fragment key={project.id}>
                          <SidebarMenuItem>
                            <SidebarMenuButton
                              className="h-auto items-center gap-2 py-1.5"
                              tooltip={project.name}
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
                              <Folder className="size-3 shrink-0 opacity-70" />
                              <span className="min-w-0 flex-1 truncate text-xs font-medium group-data-[collapsible=icon]:hidden">
                                {project.name}
                              </span>
                              {expanded ? (
                                <ChevronDown className="size-3 shrink-0 opacity-70 group-data-[collapsible=icon]:hidden" />
                              ) : (
                                <ChevronRight className="size-3 shrink-0 opacity-70 group-data-[collapsible=icon]:hidden" />
                              )}
                              {typeof project.chatCount === "number" && (
                                <span className="text-[10px] opacity-60 group-data-[collapsible=icon]:hidden">
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
                              <SidebarMenuItem
                                key={chat.id}
                                className="pl-8 group-data-[collapsible=icon]:pl-0"
                              >
                                <SidebarMenuButton
                                  isActive={chat.id === active?.id}
                                  onClick={() => selectChat(chat.id)}
                                  className="h-auto py-1.5"
                                  tooltip={chat.title}
                                >
                                  <span className="truncate text-xs group-data-[collapsible=icon]:hidden">
                                    {chat.title}
                                  </span>
                                </SidebarMenuButton>
                                {chat.id !== DRAFT_ID && (
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
                                        onClick={() =>
                                          void togglePin(chat.id)
                                        }
                                      >
                                        {chat.pinned ? (
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
                                              void moveToProject(
                                                chat.id,
                                                null
                                              )
                                            }
                                          >
                                            {!chat.projectId && (
                                              <Check className="size-3.5" />
                                            )}
                                            <span
                                              className={
                                                chat.projectId
                                                  ? "pl-5"
                                                  : undefined
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
                                                  chat.id,
                                                  project.id
                                                )
                                              }
                                            >
                                              {chat.projectId ===
                                                project.id && (
                                                <Check className="size-3.5" />
                                              )}
                                              <span
                                                className={
                                                  chat.projectId ===
                                                  project.id
                                                    ? undefined
                                                    : "pl-5"
                                                }
                                              >
                                                {project.name}
                                              </span>
                                            </DropdownMenuItem>
                                          ))}
                                        </DropdownMenuSubContent>
                                      </DropdownMenuSub>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        variant="destructive"
                                        onClick={() =>
                                          setDeleteTarget({
                                            type: "chat",
                                            id: chat.id,
                                            name: chat.title,
                                          })
                                        }
                                      >
                                        <Trash2 className="size-3.5" />
                                        Delete
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )}
                              </SidebarMenuItem>
                            ))}
                        </Fragment>
                      )
                    })}
                  </SidebarMenu>
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
                <FileText className="size-4 shrink-0" />
                <span className="truncate group-data-[collapsible=icon]:hidden">
                  Chats
                </span>
                {showChats ? (
                  <ChevronDown className="size-3 group-data-[collapsible=icon]:hidden" />
                ) : (
                  <ChevronRight className="size-3 group-data-[collapsible=icon]:hidden" />
                )}
                <span className="ml-auto text-[10px] opacity-60 group-data-[collapsible=icon]:hidden">
                  {unfiledChats.length}
                </span>
              </button>
            </SidebarGroupLabel>
            {showChats && (
              <SidebarGroupContent className="animate-sidebar-section">
                <SidebarMenu>
                  {loading && sessions.length <= 1 && (
                    <p className="px-2 py-6 text-center text-sm text-muted-foreground group-data-[collapsible=icon]:hidden">
                      Loading chats…
                    </p>
                  )}
                  {unfiledChats.length === 0 && !loading && (
                    <p className="px-2 py-6 text-center text-sm text-muted-foreground group-data-[collapsible=icon]:hidden">
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
                          className="h-auto flex-col items-start gap-0.5 py-2 pr-8 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:pr-2"
                          tooltip={session.title}
                        >
                          <span className="flex w-full items-center gap-1.5 group-data-[collapsible=icon]:hidden">
                            {session.pinned && (
                              <Pin className="size-3 shrink-0 opacity-70" />
                            )}
                            <span className="truncate text-xs font-medium">
                              {session.title}
                            </span>
                          </span>
                          <span className="text-[10px] opacity-70 group-data-[collapsible=icon]:hidden">
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
                                        session.projectId
                                          ? "pl-5"
                                          : undefined
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
                                onClick={() =>
                                  setDeleteTarget({
                                    type: "chat",
                                    id: session.id,
                                    name: session.title,
                                  })
                                }
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

                <div ref={loadMoreRef} className="h-1 w-full" />
                {loadingMore && (
                  <p className="flex items-center justify-center gap-2 px-2 py-3 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                    <Loader2 className="size-3.5 animate-spin" />
                    Loading more…
                  </p>
                )}
                {!hasMore &&
                  sessions.some((s) => s.id !== DRAFT_ID) &&
                  !loading && (
                    <p className="px-2 py-3 text-center text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                      End of chats
                    </p>
                  )}
              </SidebarGroupContent>
            )}
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="border-t border-sidebar-border p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton tooltip="Account" className="justify-center">
                <Avatar size="sm">
                  <AvatarFallback>
                    <User className="size-3" />
                  </AvatarFallback>
                </Avatar>
                <span className="truncate text-xs group-data-[collapsible=icon]:hidden">
                  Account
                </span>
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" className="w-48">
              <DropdownMenuItem asChild>
                <Link href="/dashboard">Dashboard</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => {
                  localStorage.removeItem("token")
                  window.location.href = "/signin"
                }}
              >
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-h-0 overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/80 px-3 sm:px-4">
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
          <ThemeToggle />
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="hidden sm:inline-flex"
          >
            <Link href="/dashboard">Dashboard</Link>
          </Button>
        </header>

        <div className="relative min-h-0 flex-1">
          <div ref={scrollRef} className="absolute inset-0 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-8 pb-28 sm:px-6 sm:pb-32">
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
                      <div className="max-w-[85%] rounded-2xl bg-primary px-4 py-3 text-sm leading-relaxed text-primary-foreground sm:max-w-[75%]">
                        <ExpandableMessage content={message.content} />
                      </div>
                    </div>
                  ) : (
                    <div
                      key={message.id}
                      className="w-full space-y-2 text-sm leading-6 text-foreground"
                    >
                      <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                        RecallOS
                      </p>
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <MarkdownContent content={message.content} />
                      </div>
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
                  className="max-h-32 min-h-9 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0"
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

      {/* Create Project Modal */}
      <Dialog
        open={showCreateProjectModal}
        onOpenChange={setShowCreateProjectModal}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Create a project to organize chats and set a shared system prompt.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                void createProject()
              }
            }}
            placeholder="Project name"
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowCreateProjectModal(false)
                setNewProjectName("")
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={!newProjectName.trim() || creatingProject}
              onClick={() => void createProject()}
            >
              {creatingProject ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Create"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Project Modal */}
      <Dialog
        open={showEditProjectModal}
        onOpenChange={(open) => {
          if (!open) {
            setShowEditProjectModal(false)
            setEditingProject(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit project</DialogTitle>
            <DialogDescription>
              Rename the project or change its system prompt.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name</label>
              <Input
                value={editProjectName}
                onChange={(e) => setEditProjectName(e.target.value)}
                placeholder="Project name"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">System prompt</label>
              <Textarea
                value={editProjectPrompt}
                onChange={(e) => setEditProjectPrompt(e.target.value)}
                rows={4}
                placeholder="Extra system prompt for chats in this project…"
                className="resize-y"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive sm:mr-auto"
              onClick={() => {
                if (editingProject) {
                  setDeleteTarget({
                    type: "project",
                    id: editingProject.id,
                    name: editingProject.name,
                  })
                  setShowEditProjectModal(false)
                }
              }}
            >
              <Trash2 className="size-4" />
              Delete project
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setShowEditProjectModal(false)
                setEditingProject(null)
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={savingProject || !editProjectName.trim()}
              onClick={() => void saveProject()}
            >
              {savingProject ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Save"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {deleteTarget?.type === "chat" ? "chat" : "project"}?
            </DialogTitle>
            <DialogDescription>
              {deleteTarget?.type === "chat"
                ? `Delete "${deleteTarget?.name}"? This cannot be undone.`
                : `Delete "${deleteTarget?.name}"? Chats will be unfiled, not deleted.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  )
}
