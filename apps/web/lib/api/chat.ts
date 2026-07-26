import axios from "axios"
import {
  API_BASE_CHAT,
  API_BASE_PROJECTS,
  API_BASE_UPLOAD,
  PAGE_SIZE,
  authHeaders,
} from "../api"
import type { ChatListItem, Message, Project } from "@/components/chat-app/types"

export type ChatListPage = {
  chats: ChatListItem[]
  nextCursor: string | null
  hasMore: boolean
}

export type ChatDetail = {
  id: string
  title: string
  pinned: boolean
  projectId?: string | null
  updatedAt: string
  messages: Message[]
  project?: { id: string; name: string } | null
}

export async function fetchChatsPage(
  cursor?: string | null
): Promise<ChatListPage> {
  const { data } = await axios.get(`${API_BASE_CHAT}/`, {
    headers: authHeaders(),
    params: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) },
  })
  return {
    chats: data.chats ?? [],
    nextCursor: data.nextCursor ?? null,
    hasMore: Boolean(data.hasMore),
  }
}

export async function fetchChatDetail(chatId: string): Promise<ChatDetail> {
  const { data } = await axios.get(`${API_BASE_CHAT}/${chatId}`, {
    headers: authHeaders(),
  })
  return data.chat as ChatDetail
}

export async function patchChat(
  id: string,
  body: { pinned?: boolean; projectId?: string | null; title?: string }
) {
  const { data } = await axios.patch(`${API_BASE_CHAT}/${id}`, body, {
    headers: authHeaders(),
  })
  return data.chat
}

export async function deleteChat(id: string): Promise<void> {
  await axios.delete(`${API_BASE_CHAT}/${id}`, { headers: authHeaders() })
}

export async function fetchProjects(): Promise<Project[]> {
  const { data } = await axios.get(`${API_BASE_PROJECTS}/`, {
    headers: authHeaders(),
  })
  return (data.projects ?? []).map((p: Project) => ({
    id: p.id,
    name: p.name,
    systemPrompt: p.systemPrompt ?? null,
    chatCount: p.chatCount,
  }))
}

export async function createProject(name: string): Promise<Project> {
  const { data } = await axios.post(
    `${API_BASE_PROJECTS}/`,
    { name },
    { headers: authHeaders() }
  )
  const project = data.project as Project
  return {
    id: project.id,
    name: project.name,
    systemPrompt: project.systemPrompt ?? null,
    chatCount: 0,
  }
}

export async function updateProject(
  id: string,
  body: { name: string; systemPrompt: string | null }
): Promise<Project> {
  const { data } = await axios.patch(`${API_BASE_PROJECTS}/${id}`, body, {
    headers: authHeaders(),
  })
  const updated = data.project as Project
  return {
    id: updated.id,
    name: updated.name,
    systemPrompt: updated.systemPrompt ?? null,
    chatCount: updated.chatCount,
  }
}

export async function deleteProject(id: string): Promise<void> {
  await axios.delete(`${API_BASE_PROJECTS}/${id}`, { headers: authHeaders() })
}

export async function uploadChatFile(file: File): Promise<string> {
  const { data: urlData } = await axios.post(
    `${API_BASE_UPLOAD}/post-file-url`,
    { fileName: file.name, contentType: file.type },
    { headers: authHeaders() }
  )

  await axios.put(urlData.presignedUrl, file, {
    headers: { "Content-Type": file.type },
  })

  const { data: confirmData } = await axios.post(
    `${API_BASE_UPLOAD}/confirm`,
    { fileName: file.name, key: urlData.key, size: file.size },
    { headers: authHeaders() }
  )

  return confirmData.documentId as string
}
