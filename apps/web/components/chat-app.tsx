"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import axios from "axios"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import {
  BookOpen,
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
  User,
  X,
} from "lucide-react"

import { ThemeToggle } from "@/components/theme-toggle"
import { cn } from "@/lib/utils"
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
  useSidebar,
} from "@/components/ui/sidebar"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

import "katex/dist/katex.min.css"

const API_BASE = "http://localhost:3000/api/v1"
const API_BASE_CHAT = `${API_BASE}/chat`
const API_BASE_PROJECTS = `${API_BASE}/projects`
const API_BASE_UPLOAD = `${API_BASE}/upload`
const PAGE_SIZE = 20

type Role = "user" | "assistant"

type SourceChunk = {
  rank: number
  id: string
  score: number
  text: string
}

type Message = {
  id: string
  role: Role
  content: string
  sourceChunks?: SourceChunk[]
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

/* ── Markdown renderer ────────────────────────────────────────── */

function MarkdownContent({ content, onSourceClick }: { content: string; onSourceClick?: (rank: number) => void }) {
  const processed = onSourceClick
    ? content.replace(/\[(\d+)\](?!\()/g, (m, rank) => `[\u200B${rank}\u200B](source:${rank})`)
    : content

  return (
    <Markdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        pre: ({ children }) => (
          <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 text-xs">{children}</pre>
        ),
        code: ({ className, children, ...props }) => {
          const isBlock = className?.startsWith("language-")
          if (isBlock) return <code className={className} {...props}>{children}</code>
          return <code className="rounded bg-muted/50 px-1.5 py-0.5 text-xs" {...props}>{children}</code>
        },
        ul: ({ children }) => <ul className="mb-2 list-inside list-disc space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="mb-2 list-inside list-decimal space-y-1">{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        h1: ({ children }) => <h1 className="mb-2 text-lg font-semibold">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-2 text-base font-semibold">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-1 text-sm font-semibold">{children}</h3>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-muted-foreground/30 pl-3 italic text-muted-foreground">{children}</blockquote>
        ),
        table: ({ children }) => <div className="mb-2 overflow-x-auto"><table className="w-full text-sm">{children}</table></div>,
        th: ({ children }) => <th className="border-b border-border px-2 py-1 text-left font-medium">{children}</th>,
        td: ({ children }) => <td className="border-b border-border px-2 py-1">{children}</td>,
        a: ({ children, href }) => {
          if (href?.startsWith("source:") && onSourceClick) {
            const rank = parseInt(href.slice(7))
            return (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); onSourceClick(rank) }}
                className="inline-flex items-center rounded bg-primary/10 px-1 py-0.5 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors align-middle cursor-pointer"
              >
                {children}
              </button>
            )
          }
          return <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">{children}</a>
        },
        hr: () => <hr className="my-3 border-border" />,
      }}
    >
      {processed}
    </Markdown>
  )
}

/* ── Expandable user message ──────────────────────────────────── */

function ExpandableMessage({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  const needsTruncate = content.length > 300
  const display = expanded || !needsTruncate ? content : content.slice(0, 300) + "…"

  return (
    <div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{display}</p>
      {needsTruncate && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-2 cursor-pointer rounded-md bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  )
}

/* ── Floating panel (projects / chats) ────────────────────────── */

function FloatingPanel({
  open,
  onClose,
  children,
  title,
  count,
}: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  title: string
  count?: number
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (ref.current?.contains(target)) return
      // Keep open when toggling the sidebar icon that owns this panel
      if (target.closest?.("[data-panel-trigger]")) return
      onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("mousedown", handleClick)
    document.addEventListener("keydown", handleKey)
    return () => {
      document.removeEventListener("mousedown", handleClick)
      document.removeEventListener("keydown", handleKey)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={ref}
      className="animate-panel-in fixed top-14 left-[calc(var(--sidebar-width-icon)+0.5rem)] z-[200] flex max-h-[min(22rem,calc(100svh-5rem))] w-56 flex-col overflow-hidden rounded-xl border border-zinc-300 bg-zinc-200 shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-300/80 px-2.5 py-2 dark:border-zinc-700/80">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium">{title}</span>
          {typeof count === "number" && (
            <span className="text-[10px] opacity-60">{count}</span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">{children}</div>
    </div>
  )
}

/* ── Main component ───────────────────────────────────────────── */

export default function ChatPage() {
  return (
    <SidebarProvider defaultOpen className="h-svh! min-h-0!">
      <ChatLayout />
    </SidebarProvider>
  )
}

function ChatLayout() {
  const { state: sidebarState } = useSidebar()
  const [sessions, setSessions] = useState<ChatSession[]>([emptyDraft()])
  const [activeId, setActiveId] = useState(DRAFT_ID)
  const [query, setQuery] = useState("")
  const [draft, setDraft] = useState("")
  const [attachedFile, setAttachedFile] = useState<File | null>(null)
  const [uploadingFile, setUploadingFile] = useState(false)
  const [listening, setListening] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(new Set())
  const [showProjects, setShowProjects] = useState(true)
  const [showChats, setShowChats] = useState(true)
  const [creatingProject, setCreatingProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState("")
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [editProjectName, setEditProjectName] = useState("")
  const [editProjectPrompt, setEditProjectPrompt] = useState("")
  const [savingProject, setSavingProject] = useState(false)
  const [useragent, setUseragent] = useState<string>("");

  // Floating panel states (collapsed sidebar pickers)
  const [openPanel, setOpenPanel] = useState<"projects" | "chats" | null>(null)
  const [panelProjectIds, setPanelProjectIds] = useState<Set<string>>(new Set())

  // Source chunks panel
  const [openSourceMsgId, setOpenSourceMsgId] = useState<string | null>(null)

  // Modal states
  const [showCreateProjectModal, setShowCreateProjectModal] = useState(false)
  const [showEditProjectModal, setShowEditProjectModal] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{
    type: "chat" | "project"
    id: string
    name: string
  } | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Cancel sending
  const abortRef = useRef<AbortController | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const loadingMoreRef = useRef(false)

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0]

  /* ── Data fetching ────────────────────────────────────────── */

  const fetchChatPage = useCallback(async (cursor?: string | null) => {
    const { data } = await axios.get(`${API_BASE_CHAT}/`, {
      headers: authHeaders(),
      params: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) },
    })
    return data as { chats: ChatListItem[]; nextCursor: string | null; hasMore: boolean }
  }, [])

  const loadProjects = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_BASE_PROJECTS}/`, { headers: authHeaders() })
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
          prev.filter((s) => s.id !== DRAFT_ID && s.messagesLoaded).map((s) => [s.id, s])
        )
        const merged = chats.map((c) => {
          const existing = loadedById.get(c.id)
          if (!existing) return c
          return { ...c, messages: existing.messages, messagesLoaded: true, messageCount: Math.max(c.messageCount, existing.messages.length) }
        })
        const draftSession = prev.find((s) => s.id === DRAFT_ID && s.messages.length === 0)
        return draftSession ? [draftSession, ...merged] : [emptyDraft(), ...merged]
      })
      setActiveId((current) => {
        if (current === DRAFT_ID) return DRAFT_ID
        return chats.some((c) => c.id === current) ? current : DRAFT_ID
      })
    } catch {
      setError("Could not load chats. Sign in and ensure the backend is running.")
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
        return [...prev, ...chats.filter((c) => !existingIds.has(c.id))]
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
      const { data } = await axios.get(`${API_BASE_CHAT}/${chatId}`, { headers: authHeaders() })
      const chat = data.chat as {
        id: string; title: string; pinned: boolean; projectId?: string | null
        updatedAt: string; messages: Message[]; project?: { id: string; name: string } | null
      }
      const messages: Message[] = (chat.messages ?? []).map((m) => ({
        id: m.id, role: m.role as Role, content: m.content,
        sourceChunks: (m.sourceChunks as SourceChunk[] | null | undefined) ?? undefined,
        createdAt: typeof m.createdAt === "string" ? m.createdAt : new Date(m.createdAt).toISOString(),
      }))
      setSessions((prev) =>
        prev.map((s) =>
          s.id === chatId
            ? { ...s, title: chat.title, pinned: chat.pinned, projectId: chat.projectId ?? chat.project?.id ?? null,
                projectName: chat.project?.name ?? s.projectName,
                updatedAt: typeof chat.updatedAt === "string" ? chat.updatedAt : new Date(chat.updatedAt).toISOString(),
                messages, messageCount: messages.length, messagesLoaded: true }
            : s
        )
      )
    } catch (e) {
      setError(axios.isAxiosError(e) ? (e.response?.data?.message as string) || e.message : "Failed to load chat messages")
    } finally {
      setLoadingMessages(false)
    }
  }, [])

  useEffect(() => { void loadChats(); void loadProjects() }, [loadChats, loadProjects])

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
      (entries) => { if (entries[0]?.isIntersecting) void loadMoreChats() },
      { root: el.closest('[data-sidebar="content"]') ?? null, rootMargin: "80px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMoreChats, sessions.length])

  useEffect(() => {
      if (navigator.userAgent) {
        console.log("useragent:", navigator.userAgent);
        setUseragent(navigator.userAgent);
      }
  })

  /* ── Derived data ─────────────────────────────────────────── */

  const sortSessions = (a: ChatSession, b: ChatSession) => {
    if (a.id === DRAFT_ID) return -1
    if (b.id === DRAFT_ID) return 1
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return +new Date(b.updatedAt) - +new Date(a.updatedAt)
  }

  const unfiledChats = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sessions.filter((s) => !s.projectId && (q ? s.title.toLowerCase().includes(q) : true)).sort(sortSessions)
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

  // Floating pickers only apply while the icon rail is collapsed
  useEffect(() => {
    if (sidebarState === "expanded") setOpenPanel(null)
  }, [sidebarState])

  /* ── Actions ──────────────────────────────────────────────── */

  const createChat = () => {
    setSessions((prev) => {
      const withoutEmptyDraft = prev.filter((s) => !(s.id === DRAFT_ID && s.messages.length === 0))
      return [emptyDraft(), ...withoutEmptyDraft]
    })
    setActiveId(DRAFT_ID)
    setDraft("")
    setAttachedFile(null)
    setError("")
  }

  const selectChat = (id: string) => { setActiveId(id); setError(""); setOpenPanel(null) }

  const togglePin = async (id: string) => {
    if (id === DRAFT_ID) return
    const session = sessions.find((s) => s.id === id)
    if (!session) return
    const nextPinned = !session.pinned
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, pinned: nextPinned } : s)))
    try { await axios.patch(`${API_BASE_CHAT}/${id}`, { pinned: nextPinned }, { headers: authHeaders() }) }
    catch { setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, pinned: !nextPinned } : s))) }
  }

  const deleteChat = async (id: string) => {
    if (id === DRAFT_ID) return
    const snapshot = sessions
    setSessions((prev) => prev.filter((s) => s.id !== id))
    if (activeId === id) setActiveId(DRAFT_ID)
    try { await axios.delete(`${API_BASE_CHAT}/${id}`, { headers: authHeaders() }) }
    catch { setSessions(snapshot); setError("Failed to delete chat") }
  }

  const moveToProject = async (chatId: string, projectId: string | null) => {
    if (chatId === DRAFT_ID) return
    const projectName = projectId == null ? null : projects.find((p) => p.id === projectId)?.name ?? null
    setSessions((prev) => prev.map((s) => (s.id === chatId ? { ...s, projectId, projectName } : s)))
    try { await axios.patch(`${API_BASE_CHAT}/${chatId}`, { projectId }, { headers: authHeaders() }); void loadProjects() }
    catch { setError("Failed to move chat"); void loadChats() }
  }

  const createProject = async () => {
    const name = newProjectName.trim()
    if (!name || creatingProject) return
    setCreatingProject(true)
    try {
      const { data } = await axios.post(`${API_BASE_PROJECTS}/`, { name }, { headers: authHeaders() })
      const project = data.project as Project
      setProjects((prev) => [{ id: project.id, name: project.name, systemPrompt: project.systemPrompt ?? null, chatCount: 0 }, ...prev])
      setNewProjectName("")
      setShowCreateProjectModal(false)
    } catch { setError("Failed to create project") }
    finally { setCreatingProject(false) }
  }

  const openEditProject = (project: Project) => {
    setEditingProject(project)
    setEditProjectName(project.name)
    setEditProjectPrompt(project.systemPrompt ?? "")
    setShowEditProjectModal(true)
    setOpenPanel(null)
  }

  const saveProject = async () => {
    if (!editingProject || savingProject) return
    const name = editProjectName.trim()
    if (!name) return
    setSavingProject(true)
    try {
      const { data } = await axios.patch(`${API_BASE_PROJECTS}/${editingProject.id}`,
        { name, systemPrompt: editProjectPrompt.trim() || null }, { headers: authHeaders() })
      const updated = data.project as Project
      setProjects((prev) => prev.map((p) => (p.id === updated.id ? { ...p, name: updated.name, systemPrompt: updated.systemPrompt ?? null } : p)))
      setSessions((prev) => prev.map((s) => (s.projectId === updated.id ? { ...s, projectName: updated.name } : s)))
      setShowEditProjectModal(false)
      setEditingProject(null)
    } catch { setError("Failed to update project") }
    finally { setSavingProject(false) }
  }

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      if (deleteTarget.type === "chat") {
        await deleteChat(deleteTarget.id)
      } else {
        await axios.delete(`${API_BASE_PROJECTS}/${deleteTarget.id}`, { headers: authHeaders() })
        setProjects((prev) => prev.filter((p) => p.id !== deleteTarget.id))
        setSessions((prev) => prev.map((s) => (s.projectId === deleteTarget.id ? { ...s, projectId: null, projectName: null } : s)))
        if (editingProject?.id === deleteTarget.id) { setShowEditProjectModal(false); setEditingProject(null) }
      }
    } catch { setError(`Failed to delete ${deleteTarget.type}`) }
    finally { setDeleting(false); setDeleteTarget(null) }
  }

  /* ── File upload (presigned URL flow) ─────────────────────── */

  const uploadFile = async (file: File): Promise<string | null> => {
    try {
      setUploadingFile(true)
      const { data: urlData } = await axios.post(`${API_BASE_UPLOAD}/post-file-url`,
        { fileName: file.name, contentType: file.type }, { headers: authHeaders() })

      await axios.put(urlData.presignedUrl, file, {
        headers: { "Content-Type": file.type },
      })

      const { data: confirmData } = await axios.post(`${API_BASE_UPLOAD}/confirm`,
        { fileName: file.name, key: urlData.key, size: file.size }, { headers: authHeaders() })

      return confirmData.documentId as string
    } catch (e) {
      console.error("[chat:uploadFile]", e)
      setError("Failed to upload file")
      return null
    } finally {
      setUploadingFile(false)
    }
  }

  /* ── Send message ─────────────────────────────────────────── */

  const sendMessage = async () => {
    const text = draft.trim() + "useragent info from browser: " + useragent;
    if (!text || !active || sending) return

    // Upload attached file first
    let docInfo = ""
    if (attachedFile) {
      const docId = await uploadFile(attachedFile)
      if (docId) docInfo = `\n\n📎 Uploaded: ${attachedFile.name} (Document ID: ${docId})`
      setAttachedFile(null)
    }

    const content = text + docInfo
    const tempUserId = `temp-user-${crypto.randomUUID()}`
    const optimisticUser: Message = { id: tempUserId, role: "user", content, createdAt: new Date().toISOString() }

    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== active.id) return s
        return { ...s,
          title: s.title === "New chat" && s.messages.length === 0 ? text.slice(0, 48) + (text.length > 48 ? "…" : "") : s.title,
          updatedAt: new Date().toISOString(), messages: [...s.messages, optimisticUser],
          messageCount: s.messageCount + 1, messagesLoaded: true,
        }
      })
    )
    setDraft("")
    setSending(true)
    setError("")

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const body: { message: string; chatId?: string } = { message: content }
      if (active.id !== DRAFT_ID) body.chatId = active.id

      const { data } = await axios.post(`${API_BASE_CHAT}/message`, body, {
        headers: authHeaders(), signal: controller.signal,
      })

      const chatId: string = data.chatId
      const userMsg: Message = { id: data.userMessage.id, role: "user", content: data.userMessage.content, createdAt: data.userMessage.createdAt }
      const assistantMsg: Message = { id: data.assistantMessage.id, role: "assistant", content: data.assistantMessage.content, createdAt: data.assistantMessage.createdAt, sourceChunks: data.sources ?? [] }

      setSessions((prev) => {
        const rest = prev.filter((s) => s.id !== active.id && s.id !== chatId)
        const prior = prev.find((s) => s.id === active.id) ?? prev.find((s) => s.id === chatId)
        const priorWithoutTemp = (prior?.messages ?? []).filter((m) => m.id !== tempUserId)
        const messages = [...priorWithoutTemp, userMsg, assistantMsg]
        const updated: ChatSession = {
          id: chatId, title: data.title ?? prior?.title ?? "Chat", pinned: prior?.pinned ?? false,
          projectId: prior?.projectId ?? null, projectName: prior?.projectName ?? null,
          updatedAt: new Date().toISOString(), messages, messageCount: messages.length, messagesLoaded: true,
        }
        const needsDraft = !rest.some((s) => s.id === DRAFT_ID)
        return needsDraft ? [emptyDraft(), updated, ...rest] : [updated, ...rest]
      })
      setActiveId(chatId)
    } catch (e) {
      if (axios.isCancel(e)) {
        setSessions((prev) => prev.map((s) => {
          if (s.id !== active.id) return s
          return { ...s, messages: s.messages.filter((m) => m.id !== tempUserId), messageCount: Math.max(0, s.messageCount - 1) }
        }))
        setDraft(text)
      } else {
        setError(axios.isAxiosError(e) ? (e.response?.data?.message as string) || e.message : "Failed to send message")
        setSessions((prev) => prev.map((s) => {
          if (s.id !== active.id) return s
          return { ...s, messages: s.messages.filter((m) => m.id !== tempUserId), messageCount: Math.max(0, s.messageCount - 1) }
        }))
        setDraft(text)
      }
    } finally {
      setSending(false)
      abortRef.current = null
    }
  }

  const cancelSending = () => { abortRef.current?.abort() }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      void sendMessage()
    }
  }

  const showEmptyState =
    (!active || (active.messagesLoaded && active.messages.length === 0)) && !sending && !loadingMessages

  /* ── Top 5 pinned chats ───────────────────────────────────── */

  // Collapsed picker lists — unfiled only (project chats live under Projects)
  const pinnedChats = useMemo(
    () =>
      sessions
        .filter((s) => s.id !== DRAFT_ID && s.pinned && !s.projectId)
        .sort(sortSessions)
        .slice(0, 8),
    [sessions]
  )
  const recentChats = useMemo(
    () =>
      sessions
        .filter((s) => s.id !== DRAFT_ID && !s.pinned && !s.projectId)
        .sort(sortSessions)
        .slice(0, 20),
    [sessions]
  )

  /* ── Render ───────────────────────────────────────────────── */

  return (
    <>
      <Sidebar collapsible="icon" className="border-r">
        {/* ── Header ─────────────────────────────────────────── */}
        {sidebarState === "expanded" ? (
          <SidebarHeader className="gap-2 p-2">
            <div className="mt-3 flex items-center gap-2">
              <SidebarTrigger />
              <span className="font-display truncate text-base font-medium tracking-tight">
                RecallOS
              </span>
            </div>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={createChat} tooltip="New chat" className="mt-6">
                  <SquarePen className="size-4" />
                  <span className="truncate">New chat</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search chats…"
                className="h-9 w-full rounded-md border border-sidebar-border bg-background pr-3 pl-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </div>
          </SidebarHeader>
        ) : (
          <SidebarHeader className="items-center gap-1 p-2">
            <SidebarTrigger className="size-8" />
            <SidebarMenu className="items-center">
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => {
                    createChat()
                    setOpenPanel(null)
                  }}
                  tooltip="New chat"
                  className="justify-center"
                >
                  <SquarePen className="size-4" />
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
        )}

        {/* ── Sidebar content ────────────────────────────────── */}
        <SidebarContent>
          {sidebarState === "collapsed" ? (
            /* ── Collapsed: major icons only ─────────────────── */
            <SidebarMenu className="items-center gap-1 px-0">
              <SidebarMenuItem>
                <SidebarMenuButton
                  data-panel-trigger
                  tooltip="Projects"
                  onClick={() => setOpenPanel(openPanel === "projects" ? null : "projects")}
                  isActive={openPanel === "projects"}
                  className="justify-center"
                >
                  <Folder className="size-4" />
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  data-panel-trigger
                  tooltip="Chats"
                  onClick={() => setOpenPanel(openPanel === "chats" ? null : "chats")}
                  isActive={openPanel === "chats"}
                  className="justify-center"
                >
                  <FileText className="size-4" />
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          ) : (
            /* ── Expanded: full projects & chats sections ──────── */
            <>
              {/* Projects */}
              <SidebarGroup>
                <SidebarGroupLabel asChild>
                  <button
                    onClick={() => setShowProjects(!showProjects)}
                    className="flex w-full cursor-pointer items-center gap-1.5"
                  >
                    <Folder className="size-4 shrink-0" />
                    <span className="truncate">Projects</span>
                    {showProjects ? (
                      <ChevronDown className="size-1" />
                    ) : (
                      <ChevronRight className="size-1" />
                    )}
                    <span className="text-[10px] opacity-60">{projects.length}</span>
                    <span
                      className="ml-auto flex size-3.5 items-center justify-center rounded opacity-60 hover:opacity-100"
                      title="New project"
                      onClick={(e) => { e.stopPropagation(); setShowCreateProjectModal(true) }}
                    >
                      <Plus className="size-3" />
                    </span>
                  </button>
                </SidebarGroupLabel>
                {showProjects && (
                  <SidebarGroupContent className="animate-sidebar-section">
                    {projects.length === 0 ? (
                      <p className="px-2 py-2 text-xs text-muted-foreground">No projects yet.</p>
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
                                  tooltip={project.name}
                                  onClick={() => setExpandedProjectIds((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(project.id)) next.delete(project.id)
                                    else next.add(project.id)
                                    return next
                                  })}
                                >
                                  <Folder className="size-3 shrink-0 opacity-70" />
                                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{project.name}</span>
                                  {expanded ? (
                                    <ChevronDown className="size-1 shrink-0 opacity-70" />
                                  ) : (
                                    <ChevronRight className="size-1 shrink-0 opacity-70" />
                                  )}
                                  {typeof project.chatCount === "number" && (
                                    <span className="text-[10px] opacity-60">{project.chatCount}</span>
                                  )}
                                </SidebarMenuButton>
                                <SidebarMenuAction showOnHover title="Edit project" onClick={() => openEditProject(project)}>
                                  <Settings2 className="size-2 mb-1" />
                                </SidebarMenuAction>
                              </SidebarMenuItem>
                              {expanded && projectChats.map((chat) => (
                                <SidebarMenuItem key={chat.id} className="pl-8">
                                  <SidebarMenuButton
                                    isActive={chat.id === active?.id}
                                    onClick={() => selectChat(chat.id)}
                                    className="h-auto py-1.5"
                                    tooltip={chat.title}
                                  >
                                    <span className="truncate text-xs">{chat.title}</span>
                                  </SidebarMenuButton>
                                  {chat.id !== DRAFT_ID && (
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <SidebarMenuAction showOnHover title="More" onClick={(e) => e.stopPropagation()}>
                                          <MoreHorizontal className="size-3.5" />
                                        </SidebarMenuAction>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent side="right" align="start" className="w-48" onClick={(e) => e.stopPropagation()}>
                                        <DropdownMenuItem onClick={() => void togglePin(chat.id)}>
                                          {chat.pinned ? <><PinOff className="size-3.5" />Unpin</> : <><Pin className="size-3.5" />Pin</>}
                                        </DropdownMenuItem>
                                        <DropdownMenuSub>
                                          <DropdownMenuSubTrigger><FolderInput className="size-3.5" />Move to project</DropdownMenuSubTrigger>
                                          <DropdownMenuSubContent className="w-48">
                                            <DropdownMenuItem onClick={() => void moveToProject(chat.id, null)}>
                                              {!chat.projectId && <Check className="size-3.5" />}
                                              <span className={chat.projectId ? "pl-5" : undefined}>No project</span>
                                            </DropdownMenuItem>
                                            {projects.length > 0 && <DropdownMenuSeparator />}
                                            {projects.map((project) => (
                                              <DropdownMenuItem key={project.id} onClick={() => void moveToProject(chat.id, project.id)}>
                                                {chat.projectId === project.id && <Check className="size-3.5" />}
                                                <span className={chat.projectId === project.id ? undefined : "pl-5"}>{project.name}</span>
                                              </DropdownMenuItem>
                                            ))}
                                          </DropdownMenuSubContent>
                                        </DropdownMenuSub>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget({ type: "chat", id: chat.id, name: chat.title })}>
                                          <Trash2 className="size-3.5" />Delete
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

              {/* Chats */}
              <SidebarGroup>
                <SidebarGroupLabel asChild>
                  <button
                    onClick={() => setShowChats(!showChats)}
                    className="flex w-full cursor-pointer items-center gap-1.5"
                  >
                    <FileText className="size-4 shrink-0" />
                    <span className="truncate">Chats</span>
                    {showChats ? (
                      <ChevronDown className="size-1" />
                    ) : (
                      <ChevronRight className="size-1" />
                    )}
                    <span className="ml-auto text-[10px] opacity-60">{unfiledChats.length}</span>
                  </button>
                </SidebarGroupLabel>
                {showChats && (
                  <SidebarGroupContent className="animate-sidebar-section">
                    <SidebarMenu>
                      {loading && sessions.length <= 1 && (
                        <p className="px-2 py-6 text-center text-sm text-muted-foreground">Loading chats…</p>
                      )}
                      {unfiledChats.length === 0 && !loading && (
                        <p className="px-2 py-6 text-center text-sm text-muted-foreground">No chats match your search.</p>
                      )}
                      {unfiledChats.map((session) => {
                        const selected = session.id === active?.id
                        return (
                          <SidebarMenuItem key={session.id}>
                            <SidebarMenuButton
                              isActive={selected}
                              onClick={() => selectChat(session.id)}
                              className="h-auto flex-col items-start gap-0.5 py-2 pr-8"
                              tooltip={session.title}
                            >
                              <span className="flex w-full items-center gap-1.5">
                                {session.pinned && <Pin className="size-3 shrink-0 opacity-70" />}
                                <span className="truncate text-xs font-medium">{session.title}</span>
                              </span>
                              <span className="text-[10px] opacity-70">
                                {formatChatTime(session.updatedAt)} · {session.messageCount} messages
                                {session.projectName ? ` · ${session.projectName}` : ""}
                              </span>
                            </SidebarMenuButton>
                            {session.id !== DRAFT_ID && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <SidebarMenuAction showOnHover title="More" onClick={(e) => e.stopPropagation()}>
                                    <MoreHorizontal className="size-3.5" />
                                  </SidebarMenuAction>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent side="right" align="start" className="w-48" onClick={(e) => e.stopPropagation()}>
                                  <DropdownMenuItem onClick={() => void togglePin(session.id)}>
                                    {session.pinned ? <><PinOff className="size-3.5" />Unpin</> : <><Pin className="size-3.5" />Pin</>}
                                  </DropdownMenuItem>
                                  <DropdownMenuSub>
                                    <DropdownMenuSubTrigger><FolderInput className="size-3.5" />Move to project</DropdownMenuSubTrigger>
                                    <DropdownMenuSubContent className="w-48">
                                      <DropdownMenuItem onClick={() => void moveToProject(session.id, null)}>
                                        {!session.projectId && <Check className="size-3.5" />}
                                        <span className={session.projectId ? "pl-5" : undefined}>No project</span>
                                      </DropdownMenuItem>
                                      {projects.length > 0 && <DropdownMenuSeparator />}
                                      {projects.map((project) => (
                                        <DropdownMenuItem key={project.id} onClick={() => void moveToProject(session.id, project.id)}>
                                          {session.projectId === project.id && <Check className="size-3.5" />}
                                          <span className={session.projectId === project.id ? undefined : "pl-5"}>{project.name}</span>
                                        </DropdownMenuItem>
                                      ))}
                                      {projects.length === 0 && (
                                        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Create a project first</DropdownMenuLabel>
                                      )}
                                    </DropdownMenuSubContent>
                                  </DropdownMenuSub>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget({ type: "chat", id: session.id, name: session.title })}>
                                    <Trash2 className="size-3.5" />Delete
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
                      <p className="flex items-center justify-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" />Loading more…
                      </p>
                    )}
                    {!hasMore && sessions.some((s) => s.id !== DRAFT_ID) && !loading && (
                      <p className="px-2 py-3 text-center text-xs text-muted-foreground">End of chats</p>
                    )}
                  </SidebarGroupContent>
                )}
              </SidebarGroup>
            </>
          )}
        </SidebarContent>

        {/* ── Footer: account ────────────────────────────────── */}
        <SidebarFooter className="p-2">
          <SidebarMenu className={sidebarState === "collapsed" ? "items-center" : undefined}>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton tooltip="Account" className="justify-center">
                    <Avatar size="sm">
                      <AvatarFallback><User className="size-4" /></AvatarFallback>
                    </Avatar>
                    <span className="truncate text-md group-data-[collapsible=icon]:hidden">Account</span>
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-48">
                  <DropdownMenuItem asChild><Link href="/dashboard">Dashboard</Link></DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => { localStorage.removeItem("token"); window.location.href = "/signin" }}>
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      {/* Floating pickers — only when sidebar is collapsed */}
      {sidebarState === "collapsed" && (
        <>
          <FloatingPanel
            open={openPanel === "projects"}
            onClose={() => setOpenPanel(null)}
            title="Projects"
            count={projects.length}
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                Your projects
              </span>
              <button
                type="button"
                onClick={() => setShowCreateProjectModal(true)}
                className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                title="New project"
              >
                <Plus className="size-3.5" />
              </button>
            </div>
            {projects.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">No projects yet.</p>
            ) : (
              <div className="space-y-0.5">
                {projects.map((project) => {
                  const expanded = panelProjectIds.has(project.id)
                  const projectChats = projectChatsMap.get(project.id) ?? []
                  return (
                    <div key={project.id}>
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() =>
                            setPanelProjectIds((prev) => {
                              const next = new Set(prev)
                              if (next.has(project.id)) next.delete(project.id)
                              else next.add(project.id)
                              return next
                            })
                          }
                          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-zinc-300/70 dark:hover:bg-zinc-700/70"
                        >
                          {expanded ? (
                            <ChevronDown className="size-3 shrink-0 opacity-70" />
                          ) : (
                            <ChevronRight className="size-3 shrink-0 opacity-70" />
                          )}
                          <Folder className="size-3 shrink-0 opacity-70" />
                          <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
                          {typeof project.chatCount === "number" && (
                            <span className="text-[10px] opacity-50">{project.chatCount}</span>
                          )}
                        </button>
                        <button
                          type="button"
                          title="Edit project"
                          onClick={() => openEditProject(project)}
                          className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-zinc-300/70 hover:text-foreground dark:hover:bg-zinc-700/70"
                        >
                          <Settings2 className="size-3" />
                        </button>
                      </div>
                      {expanded && (
                        <div className="ml-4 space-y-0.5 border-l border-zinc-400/40 pl-2 dark:border-zinc-600/50">
                          {projectChats.length === 0 ? (
                            <p className="px-2 py-1.5 text-[11px] text-muted-foreground">No chats</p>
                          ) : (
                            projectChats.map((chat) => (
                              <button
                                key={chat.id}
                                type="button"
                                onClick={() => selectChat(chat.id)}
                                className={cn(
                                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-zinc-300/70 dark:hover:bg-zinc-700/70",
                                  chat.id === active?.id && "bg-zinc-300/90 font-medium dark:bg-zinc-700/90"
                                )}
                              >
                                {chat.pinned && <Pin className="size-3 shrink-0 opacity-70" />}
                                <span className="truncate">{chat.title}</span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </FloatingPanel>

          <FloatingPanel
            open={openPanel === "chats"}
            onClose={() => setOpenPanel(null)}
            title="Chats"
            count={unfiledChats.filter((s) => s.id !== DRAFT_ID).length}
          >
            <button
              type="button"
              onClick={() => {
                createChat()
                setOpenPanel(null)
              }}
              className="mb-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors hover:bg-zinc-300/70 dark:hover:bg-zinc-700/70"
            >
              <SquarePen className="size-3 shrink-0" />
              New chat
            </button>

            {pinnedChats.length > 0 && (
              <div className="mb-2">
                <div className="mb-1 flex items-center gap-1.5 px-2 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                  <Pin className="size-3 opacity-60" />
                  Pinned
                </div>
                <div className="space-y-0.5">
                  {pinnedChats.map((chat) => (
                    <button
                      key={chat.id}
                      type="button"
                      onClick={() => selectChat(chat.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-zinc-300/70 dark:hover:bg-zinc-700/70",
                        chat.id === active?.id && "bg-zinc-300/90 font-medium dark:bg-zinc-700/90"
                      )}
                    >
                      <Pin className="size-3 shrink-0 opacity-70" />
                      <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                      <span className="shrink-0 text-[10px] opacity-50">{formatChatTime(chat.updatedAt)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="mb-1 flex items-center gap-1.5 px-2 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                <FileText className="size-3 opacity-60" />
                Recent
              </div>
              {loading && sessions.length <= 1 ? (
                <p className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Loading…
                </p>
              ) : recentChats.length === 0 && pinnedChats.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">No chats yet.</p>
              ) : recentChats.length === 0 ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">No recent chats.</p>
              ) : (
                <div className="space-y-0.5">
                  {recentChats.map((chat) => (
                    <button
                      key={chat.id}
                      type="button"
                      onClick={() => selectChat(chat.id)}
                      className={cn(
                        "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-zinc-300/70 dark:hover:bg-zinc-700/70",
                        chat.id === active?.id && "bg-zinc-300/90 dark:bg-zinc-700/90"
                      )}
                    >
                      <span className={cn("truncate", chat.id === active?.id && "font-medium")}>
                        {chat.title}
                      </span>
                      <span className="text-[10px] opacity-60">
                        {formatChatTime(chat.updatedAt)}
                        {chat.projectName ? ` · ${chat.projectName}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </FloatingPanel>
        </>
      )}

      {/* Source chunks side panel */}
      {openSourceMsgId && (() => {
        const msg = active?.messages.find((m) => m.id === openSourceMsgId)
        const chunks = msg?.sourceChunks
        if (!chunks || chunks.length === 0) return null
        return (
          <div className="fixed inset-y-0 right-0 z-[200] w-80 border-l border-border bg-popover shadow-xl flex flex-col">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-popover/95 px-3 py-2.5 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <BookOpen className="size-3.5" />
                <span className="text-xs font-medium">Sources</span>
                <span className="text-[10px] opacity-60">{chunks.length}</span>
              </div>
              <button
                onClick={() => setOpenSourceMsgId(null)}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {chunks.map((chunk) => (
                <div key={chunk.id} id={`source-rank-${chunk.rank}`} className="rounded-md border border-border p-2.5 space-y-1.5 scroll-mt-12">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-semibold">
                      {chunk.rank}
                    </span>
                    <span className="text-[10px] text-muted-foreground truncate" title={chunk.id}>
                      {chunk.id.slice(0, 12)}…
                    </span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {(chunk.score * 100).toFixed(1)}%
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{chunk.text}</p>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      <SidebarInset className="min-h-0 overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/80 px-3 sm:px-4">
          <div className="min-w-0 flex-1">
            <h1 className="font-display truncate text-base font-medium tracking-tight sm:text-lg">
              {active?.title ?? "Chat"}
            </h1>
          </div>
          {active?.pinned && (
            <Badge variant="secondary" className="hidden gap-1 sm:inline-flex"><Pin className="size-3" />Pinned</Badge>
          )}
          {active?.projectName && (
            <Badge variant="outline" className="hidden gap-1 sm:inline-flex"><Folder className="size-3" />{active.projectName}</Badge>
          )}
          <ThemeToggle />
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex"><Link href="/dashboard">Dashboard</Link></Button>
        </header>

        <div className="relative min-h-0 flex-1">
          <div ref={scrollRef} className="absolute inset-0 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-8 pb-28 sm:px-6 sm:pb-32">
              {error && (
                <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
              )}

              {loadingMessages && (
                <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />Loading conversation…
                </div>
              )}

              {showEmptyState && (
                <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
                  <p className="font-mono text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">Recall-OS</p>
                  <span className="font-display text-3xl font-medium tracking-tight sm:text-4xl">
                    Ask your <span className="font-script text-foreground">memory</span>
                  </span>
                  <p className="max-w-md text-muted-foreground">
                    Query documents, notes, and organizational knowledge.
                  </p>
                </div>
              )}

              {!loadingMessages && active?.messages.map((message) =>
                message.role === "user" ? (
                  <div key={message.id} className="flex w-full justify-end">
                    <div className="max-w-[85%] rounded-2xl bg-secondary px-4 py-3 text-foreground sm:max-w-[75%]">
                      <ExpandableMessage content={message.content} />
                    </div>
                  </div>
                ) : (
                  <div key={message.id} className="w-full space-y-2 text-foreground">
                    <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">RecallOS</p>
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <MarkdownContent
                        content={message.content}
                        onSourceClick={message.sourceChunks && message.sourceChunks.length > 0
                          ? (rank) => {
                              setOpenSourceMsgId(message.id)
                              setTimeout(() => {
                                const el = document.getElementById(`source-rank-${rank}`)
                                el?.scrollIntoView({ behavior: "smooth", block: "center" })
                              }, 100)
                            }
                          : undefined}
                      />
                    </div>
                    {message.sourceChunks && message.sourceChunks.length > 0 && (
                      <button
                        onClick={() => setOpenSourceMsgId(openSourceMsgId === message.id ? null : message.id)}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <BookOpen className="size-3.5" />
                        <span>{message.sourceChunks.length} source{message.sourceChunks.length !== 1 ? "s" : ""}</span>
                      </button>
                    )}
                  </div>
                )
              )}

              {sending && (
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Searching memory and generating a reply…
                  <button onClick={cancelSending} className="text-xs font-medium text-destructive hover:underline">Cancel</button>
                </div>
              )}
              <div ref={bottomRef} className="h-px w-full shrink-0" />
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-background via-background/95 to-transparent pt-5 pb-3">
            <div className="pointer-events-auto mx-auto w-full max-w-3xl px-4 sm:px-6">
              {attachedFile && (
                <div className="mb-2 flex items-center gap-2 rounded-md bg-secondary/50 px-3 py-1.5 text-sm text-muted-foreground">
                  <FileText className="size-3.5 shrink-0" />
                  <span className="truncate">{attachedFile.name}</span>
                  {uploadingFile && <Loader2 className="size-3 animate-spin" />}
                  <button type="button" className="ml-auto shrink-0 font-medium text-foreground hover:underline" onClick={() => setAttachedFile(null)}>
                    Remove
                  </button>
                </div>
              )}

              {listening && (
                <p className="mb-2 text-center text-xs font-medium text-muted-foreground">Listening… (UI only)</p>
              )}

              <div className="memory-glow flex items-center gap-1 rounded-full border border-border/80 bg-background/90 p-1.5 backdrop-blur-sm focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30">
                <input ref={fileRef} type="file" className="hidden" accept=".pdf,application/pdf"
                  onChange={(e) => { const f = e.target.files?.[0]; setAttachedFile(f ?? null); e.target.value = "" }}
                />
                <div className="flex shrink-0 items-center gap-0.5 pl-0.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button type="button" variant="ghost" size="icon-sm" className="rounded-full" onClick={() => fileRef.current?.click()} aria-label="Upload file">
                        <Plus className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Upload a PDF</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button type="button" variant={listening ? "secondary" : "ghost"} size="icon-sm" className="rounded-full" onClick={() => setListening((v) => !v)} aria-label={listening ? "Stop microphone" : "Use microphone"}>
                        {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{listening ? "Stop listening" : "Voice input"}</TooltipContent>
                  </Tooltip>
                </div>

                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Ask anything about your knowledge base…"
                  rows={1}
                  disabled={sending || loadingMessages}
                  className="max-h-32 min-h-9 flex-1 resize-none border-0 px-2 py-2 text-sm "
                />

                <Button type="button" size="icon-sm" className="mr-0.5 shrink-0 rounded-full"
                  disabled={(!draft.trim() && !attachedFile) || sending || loadingMessages}
                  onClick={() => void sendMessage()} aria-label="Send message">
                  {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                </Button>
              </div>

              <p className="mt-1.5 text-center text-xs text-muted-foreground">
                {/* <Paperclip className="mr-1 inline size-3" /> */}
                Recall-OS can make mistakes. Check important info.
              </p>
            </div>
          </div>
        </div>
      </SidebarInset>

      {/* ── Modals ─────────────────────────────────────────── */}

      <Dialog open={showCreateProjectModal} onOpenChange={setShowCreateProjectModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>Create a project to organize chats and set a shared system prompt.</DialogDescription>
          </DialogHeader>
          <Input value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void createProject() } }}
            placeholder="Project name" autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreateProjectModal(false); setNewProjectName("") }}>Cancel</Button>
            <Button disabled={!newProjectName.trim() || creatingProject} onClick={() => void createProject()}>
              {creatingProject ? <Loader2 className="size-4 animate-spin" /> : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditProjectModal} onOpenChange={(open) => { if (!open) { setShowEditProjectModal(false); setEditingProject(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit project</DialogTitle>
            <DialogDescription>Rename the project or change its system prompt.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name</label>
              <Input value={editProjectName} onChange={(e) => setEditProjectName(e.target.value)} placeholder="Project name" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">System prompt</label>
              <Textarea value={editProjectPrompt} onChange={(e) => setEditProjectPrompt(e.target.value)} rows={4}
                placeholder="Extra system prompt for chats in this project…" className="resize-y" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" className="text-destructive hover:text-destructive sm:mr-auto"
              onClick={() => { if (editingProject) { setDeleteTarget({ type: "project", id: editingProject.id, name: editingProject.name }); setShowEditProjectModal(false) } }}>
              <Trash2 className="size-4" />Delete project
            </Button>
            <Button variant="outline" onClick={() => { setShowEditProjectModal(false); setEditingProject(null) }}>Cancel</Button>
            <Button disabled={savingProject || !editProjectName.trim()} onClick={() => void saveProject()}>
              {savingProject ? <Loader2 className="size-4 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.type === "chat" ? "chat" : "project"}?</DialogTitle>
            <DialogDescription>
              {deleteTarget?.type === "chat"
                ? `Delete "${deleteTarget?.name}"? This cannot be undone.`
                : `Delete "${deleteTarget?.name}"? Chats will be unfiled, not deleted.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" disabled={deleting} onClick={() => void confirmDelete()}>
              {deleting ? <Loader2 className="size-4 animate-spin" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
