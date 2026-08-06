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

function guessContentType(file: File): string {
  if (file.type && file.type.trim()) return file.type
  const name = file.name.toLowerCase()
  if (name.endsWith(".pdf")) return "application/pdf"
  if (name.endsWith(".png")) return "image/png"
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg"
  if (name.endsWith(".webp")) return "image/webp"
  if (name.endsWith(".gif")) return "image/gif"
  if (name.endsWith(".mp3")) return "audio/mpeg"
  if (name.endsWith(".wav")) return "audio/wav"
  if (name.endsWith(".m4a")) return "audio/mp4"
  if (name.endsWith(".mp4")) return "video/mp4"
  if (name.endsWith(".webm")) return "video/webm"
  if (name.endsWith(".mov")) return "video/quicktime"
  if (name.endsWith(".txt") || name.endsWith(".md")) return "text/plain"
  return "application/pdf"
}

export async function uploadDocument(
  file: File,
  tags: string[] = [],
  onStatus?: (status: string) => void
): Promise<{ documentId: string }> {
  const contentType = guessContentType(file)
  onStatus?.("Requesting upload URL…")
  const {
    data: { presignedUrl, key, contentType: signedType },
  } = await axios.post(
    `${API_BASE_UPLOAD}/post-file-url`,
    { fileName: file.name, contentType, size: file.size },
    { headers: authHeaders() }
  )

  const putType = (signedType as string | undefined) || contentType
  onStatus?.("Uploading file…")
  const res = await axios.put(presignedUrl, file, {
    headers: { "Content-Type": putType },
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
      contentType: putType,
      tags,
    },
    { headers: authHeaders() }
  )

  return { documentId: data.documentId as string }
}
