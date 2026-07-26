import axios from "axios"
import { API_BASE_SEARCH, SEARCH_PAGE_SIZE, authHeaders } from "../api"

export type SearchResult = {
  id: string
  title: string
  ObjectKey: string
  modality: string
  mimeType: string
  tags: string[]
  status: string
  createdAt: string
  score: number
  snippet: string | null
}

export type SearchPage = {
  documents: SearchResult[]
  offset: number
  limit: number
  hasMore: boolean
  nextOffset: number | null
  totalMatched: number
}

export async function searchDocuments(params: {
  query: string
  offset?: number
  modality?: string
  limit?: number
}): Promise<SearchPage> {
  const body: {
    query: string
    limit: number
    offset: number
    modality?: string
  } = {
    query: params.query,
    limit: params.limit ?? SEARCH_PAGE_SIZE,
    offset: params.offset ?? 0,
  }
  if (params.modality) body.modality = params.modality

  const { data } = await axios.post(`${API_BASE_SEARCH}/`, body, {
    headers: authHeaders(),
  })

  return {
    documents: data.documents ?? [],
    offset: data.offset ?? body.offset,
    limit: data.limit ?? body.limit,
    hasMore: Boolean(data.hasMore),
    nextOffset:
      typeof data.nextOffset === "number" ? data.nextOffset : null,
    totalMatched:
      typeof data.totalMatched === "number"
        ? data.totalMatched
        : (data.documents ?? []).length,
  }
}
