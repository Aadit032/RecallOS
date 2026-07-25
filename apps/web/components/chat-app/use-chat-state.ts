"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import axios from "axios"

import type {
   AgentStep,
   ChatSession,
   Message,
   Project,
   StreamEvent,
   TurnVersion,
} from "./types"
import {
   API_BASE_CHAT,
   API_BASE_PROJECTS,
   API_BASE_UPLOAD,
   DRAFT_ID,
   authHeaders,
   emptyDraft,
   isWebSearchDraft,
   mapListItem,
   sortSessions,
} from "./helpers"
import { PAGE_SIZE } from "./helpers"

export function useChatState() {
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
   const [sendStatus, setSendStatus] = useState("")
   const [agentSteps, setAgentSteps] = useState<AgentStep[]>([])
   const [agentStepsDismissed, setAgentStepsDismissed] = useState(false)
   const [error, setError] = useState("")
   const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
   const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
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
   const [openPanel, setOpenPanel] = useState<"projects" | "chats" | null>(null)
   const [panelProjectIds, setPanelProjectIds] = useState<Set<string>>(new Set())
   const [openSourceMsgId, setOpenSourceMsgId] = useState<string | null>(null)
   const [showCreateProjectModal, setShowCreateProjectModal] = useState(false)
   const [showEditProjectModal, setShowEditProjectModal] = useState(false)
   const [deleteTarget, setDeleteTarget] = useState<{
      type: "chat" | "project"
      id: string
      name: string
   } | null>(null)
   const [deleting, setDeleting] = useState(false)

   const abortRef = useRef<AbortController | null>(null)
   const agentStepsRef = useRef<AgentStep[]>([])
   const pendingEditVersionsRef = useRef<TurnVersion[] | null>(null)
   const textareaRef = useRef<HTMLTextAreaElement>(null)
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
      return data as { chats: ChatSession[]; nextCursor: string | null; hasMore: boolean }
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
            id: m.id, role: m.role as Message["role"], content: m.content,
            sourceChunks: (m.sourceChunks as Message["sourceChunks"] | null | undefined) ?? undefined,
            createdAt: typeof m.createdAt === "string" ? m.createdAt : new Date(m.createdAt).toISOString(),
         }))
         setSessions((prev) =>
            prev.map((s) =>
               s.id === chatId
                  ? {
                     ...s, title: chat.title, pinned: chat.pinned, projectId: chat.projectId ?? chat.project?.id ?? null,
                     projectName: chat.project?.name ?? s.projectName,
                     updatedAt: typeof chat.updatedAt === "string" ? chat.updatedAt : new Date(chat.updatedAt).toISOString(),
                     messages, messageCount: messages.length, messagesLoaded: true
                  }
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

   /* ── Derived data ─────────────────────────────────────────── */

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

   const lastAssistantContent =
      active?.messages.filter((m) => m.role === "assistant").at(-1)?.content ?? ""

   useEffect(() => {
      bottomRef.current?.scrollIntoView({
         behavior: sending ? "auto" : "smooth",
         block: "end",
      })
   }, [active?.messages.length, activeId, sending, lastAssistantContent])

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

   /* ── File upload ─────────────────────────────────────────── */

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

   /* ── Send message (SSE stream) ───────────────────────────── */

   const copyMessageText = async (id: string, text: string) => {
      try {
         await navigator.clipboard.writeText(text)
         setCopiedMessageId(id)
         window.setTimeout(() => setCopiedMessageId((cur) => (cur === id ? null : cur)), 1500)
      } catch {
         setError("Could not copy to clipboard")
      }
   }

   const startEditMessage = (msg: Message) => {
      if (sending) return
      setDraft(msg.content)
      setEditingMessageId(msg.id)
      setError("")
      window.setTimeout(() => {
         textareaRef.current?.focus()
         const el = textareaRef.current
         if (el) {
            el.selectionStart = el.value.length
            el.selectionEnd = el.value.length
         }
      }, 0)
   }

   const cancelEdit = () => {
      setEditingMessageId(null)
      setDraft("")
   }

   const setTurnVersion = (userMessageId: string, nextIndex: number) => {
      if (!active) return
      setSessions((prev) =>
         prev.map((s) => {
            if (s.id !== active.id) return s
            const ui = s.messages.findIndex((m) => m.id === userMessageId)
            if (ui < 0) return s
            const userMsg = s.messages[ui]!
            const versions = userMsg.versions
            if (!versions?.length || nextIndex < 0 || nextIndex >= versions.length) return s
            const v = versions[nextIndex]!
            const messages = s.messages.map((m, i) => {
               if (i === ui) {
                  return { ...m, content: v.userContent, versionIndex: nextIndex, versions }
               }
               if (i === ui + 1 && m.role === "assistant") {
                  return {
                     ...m, id: v.assistantId, content: v.assistantContent,
                     sourceChunks: v.sourceChunks, agentSteps: v.agentSteps, createdAt: v.createdAt,
                  }
               }
               return m
            })
            return { ...s, messages }
         })
      )
   }

   const sendMessage = async () => {
      const text = draft.trim()
      if (!text || !active || sending) return

      if (isWebSearchDraft(text) && !text.replace(/^\/web\s*/i, "").trim()) {
         setError("Add a query after /web, e.g. /web latest news on AI agents")
         return
      }

      let docInfo = ""
      if (attachedFile) {
         const docId = await uploadFile(attachedFile)
         if (docId) docInfo = `\n\n📎 Uploaded: ${attachedFile.name} (Document ID: ${docId})`
         setAttachedFile(null)
      }

      const content = text + docInfo
      const usingWebAgent = isWebSearchDraft(content)
      const editTargetId = editingMessageId
      const tempUserId = `temp-user-${crypto.randomUUID()}`
      const tempAssistantId = `temp-assistant-${crypto.randomUUID()}`
      const sessionKeyRef = { current: active.id }
      const liveUserIdRef = { current: tempUserId }
      const liveAssistantIdRef = { current: tempAssistantId }

      let priorVersions: TurnVersion[] = []
      if (editTargetId) {
         const editIdx = active.messages.findIndex((m) => m.id === editTargetId)
         if (editIdx >= 0) {
            const oldUser = active.messages[editIdx]!
            const oldAssistant =
               active.messages[editIdx + 1]?.role === "assistant"
                  ? active.messages[editIdx + 1]
                  : undefined
            if (oldUser.versions && oldUser.versions.length > 0) {
               priorVersions = [...oldUser.versions]
            } else if (oldAssistant) {
               priorVersions = [
                  {
                     userContent: oldUser.content,
                     assistantId: oldAssistant.id,
                     assistantContent: oldAssistant.content,
                     sourceChunks: oldAssistant.sourceChunks,
                     agentSteps: oldAssistant.agentSteps,
                     createdAt: oldAssistant.createdAt,
                  },
               ]
            }
         }
      }
      pendingEditVersionsRef.current = priorVersions.length > 0 ? priorVersions : null

      const optimisticUser: Message = {
         id: tempUserId, role: "user", content, createdAt: new Date().toISOString(),
         versions: priorVersions.length > 0 ? priorVersions : undefined,
         versionIndex: priorVersions.length > 0 ? priorVersions.length : undefined,
      }
      const optimisticAssistant: Message = {
         id: tempAssistantId, role: "assistant", content: "", createdAt: new Date().toISOString(),
      }

      setSessions((prev) =>
         prev.map((s) => {
            if (s.id !== active.id) return s
            let baseMessages = s.messages
            if (editTargetId) {
               const editIdx = baseMessages.findIndex((m) => m.id === editTargetId)
               if (editIdx >= 0) baseMessages = baseMessages.slice(0, editIdx)
            }
            return {
               ...s,
               title: s.title === "New chat" && baseMessages.length === 0
                  ? text.slice(0, 48) + (text.length > 48 ? "…" : "") : s.title,
               updatedAt: new Date().toISOString(),
               messages: [...baseMessages, optimisticUser, optimisticAssistant],
               messageCount: baseMessages.length + 2,
               messagesLoaded: true,
            }
         })
      )
      setDraft("")
      setEditingMessageId(null)
      setSending(true)
      setSendStatus(usingWebAgent ? "Web search agent starting…" : "Searching memory and generating a reply…")
      setAgentSteps([])
      agentStepsRef.current = []
      setAgentStepsDismissed(false)
      setError("")

      const controller = new AbortController()
      abortRef.current = controller

      const rollbackOptimistic = () => {
         const userId = liveUserIdRef.current
         const assistantId = liveAssistantIdRef.current
         setSessions((prev) =>
            prev.map((s) => {
               if (s.id !== sessionKeyRef.current && s.id !== active.id) return s
               const nextMessages = s.messages.filter((m) => m.id !== userId && m.id !== assistantId)
               return { ...s, messages: nextMessages, messageCount: nextMessages.length }
            })
         )
         setDraft(text)
         if (editTargetId) setEditingMessageId(editTargetId)
         pendingEditVersionsRef.current = null
      }

      try {
         const body: { message: string; chatId?: string; userAgent?: string } = {
            message: content,
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
         }
         if (active.id !== DRAFT_ID) body.chatId = active.id

         const response = await fetch(`${API_BASE_CHAT}/message`, {
            method: "POST",
            headers: {
               ...authHeaders(),
               "Content-Type": "application/json",
               Accept: "text/event-stream",
            },
            body: JSON.stringify(body),
            signal: controller.signal,
         })

         if (!response.ok) {
            let message = "Failed to send message"
            try {
               const errBody = await response.json()
               if (typeof errBody?.message === "string") message = errBody.message
            } catch { /* ignore non-JSON error bodies */ }
            throw new Error(message)
         }

         if (!response.body) throw new Error("No response body from server")

         const reader = response.body.getReader()
         const decoder = new TextDecoder()
         let buffer = ""
         let streamedContent = ""
         let finished = false

         const applyMeta = (event: Extract<StreamEvent, { type: "meta" }>) => {
            const chatId = event.chatId
            const prevUserId = liveUserIdRef.current
            const prevAssistantId = liveAssistantIdRef.current
            liveUserIdRef.current = event.userMessage.id
            const pVersions = pendingEditVersionsRef.current
            const userMsg: Message = {
               id: event.userMessage.id, role: "user", content: event.userMessage.content,
               createdAt: typeof event.userMessage.createdAt === "string"
                  ? event.userMessage.createdAt : new Date(event.userMessage.createdAt).toISOString(),
               versions: pVersions ?? undefined,
               versionIndex: pVersions ? pVersions.length : undefined,
            }

            setSessions((prev) => {
               const prior = prev.find((s) => s.id === sessionKeyRef.current)
                  ?? prev.find((s) => s.id === chatId) ?? prev.find((s) => s.id === active.id)
               const rest = prev.filter(
                  (s) => s.id !== sessionKeyRef.current && s.id !== chatId && s.id !== active.id
               )
               const kept = (prior?.messages ?? []).filter(
                  (m) => m.id !== prevUserId && m.id !== prevAssistantId
               )
               const assistant: Message = {
                  id: prevAssistantId, role: "assistant", content: streamedContent,
                  createdAt: new Date().toISOString(), sourceChunks: event.sources ?? [],
               }
               const updated: ChatSession = {
                  id: chatId, title: event.title ?? prior?.title ?? "Chat",
                  pinned: prior?.pinned ?? false, projectId: prior?.projectId ?? null,
                  projectName: prior?.projectName ?? null, updatedAt: new Date().toISOString(),
                  messages: [...kept, userMsg, assistant], messageCount: kept.length + 2,
                  messagesLoaded: true,
               }
               const needsDraft = !rest.some((s) => s.id === DRAFT_ID)
               return needsDraft ? [emptyDraft(), updated, ...rest] : [updated, ...rest]
            })
            sessionKeyRef.current = chatId
            setActiveId(chatId)
         }

         const applyDelta = (delta: string) => {
            streamedContent += delta
            const sessionId = sessionKeyRef.current
            const assistantId = liveAssistantIdRef.current
            setSessions((prev) =>
               prev.map((s) => {
                  if (s.id !== sessionId) return s
                  return {
                     ...s,
                     messages: s.messages.map((m) =>
                        m.id === assistantId ? { ...m, content: streamedContent } : m
                     ),
                  }
               })
            )
         }

         const applyDone = (event: Extract<StreamEvent, { type: "done" }>) => {
            const chatId = event.chatId
            const prevUserId = liveUserIdRef.current
            const prevAssistantId = liveAssistantIdRef.current
            liveUserIdRef.current = event.userMessage.id
            liveAssistantIdRef.current = event.assistantMessage.id
            const stepsSnapshot = [...agentStepsRef.current]
            const newVersion: TurnVersion = {
               userContent: event.userMessage.content,
               assistantId: event.assistantMessage.id,
               assistantContent: event.assistantMessage.content,
               sourceChunks: event.sources ?? [],
               agentSteps: stepsSnapshot.length > 0 ? stepsSnapshot : undefined,
               createdAt: typeof event.assistantMessage.createdAt === "string"
                  ? event.assistantMessage.createdAt : new Date(event.assistantMessage.createdAt).toISOString(),
            }
            const pVersions = pendingEditVersionsRef.current
            const allVersions = pVersions && pVersions.length > 0
               ? [...pVersions, newVersion] : undefined

            const userMsg: Message = {
               id: event.userMessage.id, role: "user", content: event.userMessage.content,
               createdAt: typeof event.userMessage.createdAt === "string"
                  ? event.userMessage.createdAt : new Date(event.userMessage.createdAt).toISOString(),
               versions: allVersions,
               versionIndex: allVersions ? allVersions.length - 1 : undefined,
            }
            const assistantMsg: Message = {
               id: event.assistantMessage.id, role: "assistant",
               content: event.assistantMessage.content, createdAt: newVersion.createdAt,
               sourceChunks: event.sources ?? [],
               agentSteps: stepsSnapshot.length > 0 ? stepsSnapshot : undefined,
            }

            setSessions((prev) => {
               const prior = prev.find((s) => s.id === sessionKeyRef.current)
                  ?? prev.find((s) => s.id === chatId) ?? prev.find((s) => s.id === active.id)
               const rest = prev.filter(
                  (s) => s.id !== sessionKeyRef.current && s.id !== chatId && s.id !== active.id
               )
               const kept = (prior?.messages ?? []).filter(
                  (m) => m.id !== prevUserId && m.id !== prevAssistantId
                     && m.id !== userMsg.id && m.id !== assistantMsg.id
               )
               const updated: ChatSession = {
                  id: chatId, title: event.title ?? prior?.title ?? "Chat",
                  pinned: prior?.pinned ?? false, projectId: prior?.projectId ?? null,
                  projectName: prior?.projectName ?? null, updatedAt: new Date().toISOString(),
                  messages: [...kept, userMsg, assistantMsg], messageCount: kept.length + 2,
                  messagesLoaded: true,
               }
               const needsDraft = !rest.some((s) => s.id === DRAFT_ID)
               return needsDraft ? [emptyDraft(), updated, ...rest] : [updated, ...rest]
            })
            sessionKeyRef.current = chatId
            setActiveId(chatId)
            pendingEditVersionsRef.current = null
            finished = true
         }

         const handleEvent = (event: StreamEvent) => {
            if (event.type === "meta") {
               if (event.mode === "web") setSendStatus("Searching the web…")
               applyMeta(event)
            } else if (event.type === "status") {
               setSendStatus(event.message)
            } else if (event.type === "agent_step") {
               const step: AgentStep = {
                  id: `step-${crypto.randomUUID()}`, step: event.step, title: event.title,
                  detail: event.detail, query: event.query, resultCount: event.resultCount,
                  iteration: event.iteration, enough: event.enough, reasoning: event.reasoning,
                  nextQuery: event.nextQuery,
               }
               agentStepsRef.current = [...agentStepsRef.current, step]
               setAgentSteps((prev) => [...prev, step])
               setAgentStepsDismissed(false)
               if (event.title) setSendStatus(event.title)
            } else if (event.type === "delta") {
               setSendStatus(usingWebAgent ? "Streaming web answer…" : "Streaming reply…")
               applyDelta(event.content)
            } else if (event.type === "done") {
               applyDone(event)
            } else if (event.type === "error") {
               throw new Error(event.message || "Stream error")
            }
         }

         while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })

            let sep: number
            while ((sep = buffer.indexOf("\n\n")) !== -1) {
               const rawEvent = buffer.slice(0, sep)
               buffer = buffer.slice(sep + 2)
               const dataLines = rawEvent
                  .split("\n")
                  .filter((line) => line.startsWith("data:"))
                  .map((line) => line.slice(5).trimStart())
               if (dataLines.length === 0) continue
               const data = dataLines.join("\n")
               if (!data || data === "[DONE]") continue
               let parsed: StreamEvent
               try {
                  parsed = JSON.parse(data) as StreamEvent
               } catch {
                  console.warn("[chat:sendMessage] Bad SSE payload:", data)
                  continue
               }
               handleEvent(parsed)
            }
         }

         if (!finished && streamedContent.length === 0) {
            throw new Error("Stream ended without a response")
         }
      } catch (e) {
         if (controller.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
            rollbackOptimistic()
         } else {
            setError(e instanceof Error ? e.message : "Failed to send message")
            rollbackOptimistic()
         }
      } finally {
         setSending(false)
         setSendStatus("")
         setAgentSteps([])
         setAgentStepsDismissed(false)
         abortRef.current = null
      }
   }

   const cancelSending = useCallback(() => {
      abortRef.current?.abort()
   }, [])

   useEffect(() => {
      if (!sending) return
      const onGlobalKeyDown = (e: KeyboardEvent) => {
         if (!e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
         if (e.key !== "c" && e.key !== "C") return
         e.preventDefault()
         e.stopPropagation()
         cancelSending()
      }
      window.addEventListener("keydown", onGlobalKeyDown, true)
      return () => window.removeEventListener("keydown", onGlobalKeyDown, true)
   }, [sending, cancelSending])

   const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
         e.preventDefault()
         void sendMessage()
      }
   }

   const showEmptyState =
      (!active || (active.messagesLoaded && active.messages.length === 0)) && !sending && !loadingMessages

   const pinnedChats = useMemo(
      () => sessions.filter((s) => s.id !== DRAFT_ID && s.pinned && !s.projectId).sort(sortSessions).slice(0, 8),
      [sessions]
   )
   const recentChats = useMemo(
      () => sessions.filter((s) => s.id !== DRAFT_ID && !s.pinned && !s.projectId).sort(sortSessions).slice(0, 20),
      [sessions]
   )

   return {
      // State
      sessions, activeId, query, draft, attachedFile, uploadingFile,
      listening, loading, loadingMore, loadingMessages, sending,
      sendStatus, agentSteps, agentStepsDismissed, error,
      editingMessageId, copiedMessageId, nextCursor, hasMore,
      projects, expandedProjectIds, showProjects, showChats,
      creatingProject, newProjectName, editingProject,
      editProjectName, editProjectPrompt, savingProject,
      openPanel, panelProjectIds, openSourceMsgId,
      showCreateProjectModal, showEditProjectModal,
      deleteTarget, deleting,
      // Refs
      textareaRef, fileRef, bottomRef, scrollRef, loadMoreRef,
      // Derived
      active, unfiledChats, projectChatsMap, showEmptyState,
      pinnedChats, recentChats,
      // Setters
      setQuery, setDraft, setAttachedFile, setListening,
      setError, setEditingMessageId, setCopiedMessageId, setEditingProject,
      setExpandedProjectIds, setShowProjects, setShowChats,
      setNewProjectName, setEditProjectName, setEditProjectPrompt,
      setOpenPanel, setPanelProjectIds, setOpenSourceMsgId,
      setShowCreateProjectModal, setShowEditProjectModal,
      setDeleteTarget, setAgentStepsDismissed,
      // Actions
      createChat, selectChat, togglePin, deleteChat, moveToProject,
      createProject, openEditProject, saveProject, confirmDelete,
      copyMessageText, startEditMessage, cancelEdit, setTurnVersion,
      sendMessage, cancelSending, onKeyDown, loadMoreChats,
      // Sidebar state
      setSidebarOpen: undefined, // placeholder, actual sidebar state managed by SidebarProvider
   }
}
