import axios from "axios"
import {
  API_BASE_DOWNLOAD,
  API_BASE_UPLOAD,
  DOCS_PAGE_SIZE,
  authHeaders,
} from "../api"

export type DocStatus =
  | "UPLOADED"
  | "QUEUED"
  | "PARSING"
  | "PARSED"
  | "EMBEDDING"
  | "INDEXED"
  | "READY"
  | "FAILED"

export type DocumentItem = {
  id: string
  title: string
  status: DocStatus
  ObjectKey: string
  modality?: string
  tags?: string[]
  createdAt: string
  updatedAt: string
}

export type DocumentsPage = {
  documents: DocumentItem[]
  nextCursor: string | null
}

export async function fetchDocumentsPage(
  cursor?: string
): Promise<DocumentsPage> {
  const params: Record<string, string | number> = { limit: DOCS_PAGE_SIZE }
  if (cursor) params.cursor = cursor
  const { data } = await axios.get(`${API_BASE_DOWNLOAD}/list`, {
    params,
    headers: authHeaders(),
  })
  return {
    documents: data.documents ?? [],
    nextCursor: data.nextCursor ?? null,
  }
}

export async function getDownloadUrl(key: string): Promise<string> {
  const { data } = await axios.post(
    `${API_BASE_DOWNLOAD}/get-download-url`,
    { key },
    { headers: authHeaders() }
  )
  return data.presignedUrl as string
}

export async function deleteDocument(id: string): Promise<void> {
  await axios.delete(`${API_BASE_DOWNLOAD}/${id}`, {
    headers: authHeaders(),
  })
}

export async function uploadDocument(
  file: File,
  tags: string[] = [],
  onStatus?: (status: string) => void
): Promise<{ documentId: string }> {
  onStatus?.("Requesting upload URL…")
  const {
    data: { presignedUrl, key },
  } = await axios.post(
    `${API_BASE_UPLOAD}/post-file-url`,
    { fileName: file.name, contentType: file.type },
    { headers: authHeaders() }
  )

  onStatus?.("Uploading file…")
  const res = await axios.put(presignedUrl, file, {
    headers: { "Content-Type": file.type },
  })

  if (res.status !== 200) {
    throw new Error("Upload failed — unexpected response.")
  }

  onStatus?.("Confirming upload…")
  const { data } = await axios.post(
    `${API_BASE_UPLOAD}/confirm`,
    {
      fileName: file.name,
      key,
      size: file.size,
      contentType: file.type,
      tags,
    },
    { headers: authHeaders() }
  )

  return { documentId: data.documentId as string }
}
