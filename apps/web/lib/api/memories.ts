import axios from "axios"
import { API_BASE_MEMORIES, authHeaders } from "../api"

export type Memory = {
  id: string
  fact: string
  importance: number | null
  source: string
  chatId: string | null
  createdAt: string
  updatedAt: string
  lastUsedAt: string | null
}

export async function fetchMemories(): Promise<Memory[]> {
  const { data } = await axios.get(`${API_BASE_MEMORIES}/`, {
    headers: authHeaders(),
  })
  return data.memories ?? []
}

export async function createMemory(fact: string, importance = 5): Promise<Memory> {
  const { data } = await axios.post(
    `${API_BASE_MEMORIES}/`,
    { fact, importance },
    { headers: authHeaders() }
  )
  return data.memory
}

export async function deleteMemory(id: string): Promise<void> {
  await axios.delete(`${API_BASE_MEMORIES}/${id}`, {
    headers: authHeaders(),
  })
}
