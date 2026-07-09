"use client"

import { useCallback, useEffect, useState } from "react"
import axios from "axios"
import Link from "next/link"
import {
  Brain,
  Download,
  FileText,
  Loader2,
  MessageSquare,
  RefreshCw,
  Upload,
  X,
} from "lucide-react"

import { ThemeToggle } from "@/components/theme-toggle"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

const API_BASE = "http://localhost:3000/api/v1/upload"

type DocStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED"

type DocumentItem = {
  id: string
  title: string
  status: DocStatus
  ObjectKey: string
  createdAt: string
  updatedAt: string
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function statusVariant(
  status: DocStatus
): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "COMPLETED":
      return "default"
    case "FAILED":
      return "destructive"
    case "PROCESSING":
      return "secondary"
    default:
      return "outline"
  }
}

const pipeline = [
  {
    step: "01",
    title: "Store",
    body: "File lands in MinIO via presigned URL.",
  },
  {
    step: "02",
    title: "Confirm",
    body: "Backend verifies size and records metadata.",
  },
  {
    step: "03",
    title: "Queue",
    body: "Document is pushed onto Redis Streams.",
  },
  {
    step: "04",
    title: "Index",
    body: "Workers parse, chunk, and embed in the background.",
  },
]

export default function Dashboard() {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [status, setStatus] = useState("")
  const [documentId, setDocumentId] = useState<string | null>(null)
  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [docsLoading, setDocsLoading] = useState(true)
  const [docsError, setDocsError] = useState("")

  const fetchDocuments = useCallback(async () => {
    setDocsLoading(true)
    setDocsError("")
    try {
      const token = localStorage.getItem("token")
      const { data } = await axios.get(`${API_BASE}/documents`, {
        headers: { Authorization: "Bearer " + token },
      })
      setDocuments(data.documents ?? [])
    } catch (e) {
      console.error(e)
      setDocsError("Could not load documents. Sign in and try again.")
    } finally {
      setDocsLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchDocuments()
  }, [fetchDocuments])

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }

    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const clearFile = () => {
    setFile(null)
    setStatus("")
    setDocumentId(null)
  }

  const handleUpload = async () => {
    if (!file) return
    setUploading(true)

    try {
      setStatus("Requesting upload URL…")
      const token = localStorage.getItem("token")

      const {
        data: { presignedUrl, key },
      } = await axios.post(
        `${API_BASE}/post-file-url`,
        { fileName: file.name, contentType: file.type },
        {
          headers: {
            Authorization: "Bearer " + token,
          },
        }
      )

      setStatus("Uploading file…")
      const res = await axios.put(presignedUrl, file, {
        headers: { "Content-Type": file.type },
      })

      if (res.status == 200) {
        setStatus("Confirming upload…")
        const { data } = await axios.post(
          `${API_BASE}/confirm`,
          {
            fileName: file.name,
            key,
            size: file.size,
          },
          {
            headers: {
              Authorization: "Bearer " + token,
            },
          }
        )
        setDocumentId(data.documentId)
        setStatus("Upload complete.")
        void fetchDocuments()
      } else {
        setStatus("Upload failed — unexpected response.")
      }
    } catch (e) {
      console.error(e)
      setStatus("Upload failed.")
    } finally {
      setUploading(false)
    }
  }

  const handleDownload = async (id?: string) => {
    const targetId = id ?? documentId
    if (!targetId) return
    const token = localStorage.getItem("token")
    const { data } = await axios.post(
      `${API_BASE}/get-file-url`,
      { documentId: targetId },
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      }
    )
    window.open(data.presignedUrl, "_blank")
  }

  const isPdf =
    file?.type === "application/pdf" || file?.name.toLowerCase().endsWith(".pdf")
  const isImage = Boolean(file?.type.startsWith("image/"))

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 tracking-tight">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Brain className="size-4" />
            </span>
            <span className="font-display text-lg tracking-wide">RecallOS</span>
          </Link>

          <nav className="flex items-center gap-1 sm:gap-2">
            <ThemeToggle />
            <Button variant="ghost" size="sm" asChild>
              <Link href="/chat">Chat</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/">Home</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:px-6 sm:py-16">
        <div className="mb-12 flex max-w-2xl flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:max-w-none">
          <div className="max-w-2xl">
            <h1 className="font-script text-6xl leading-none text-foreground sm:text-7xl md:text-8xl">
              Dashboard
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">
              Upload documents to build{" "}
              <span className="font-script text-2xl text-foreground">
                searchable memory
              </span>
              . Files are stored, parsed, and queued for indexing.
            </p>
          </div>
          <Button variant="outline" className="shrink-0" asChild>
            <Link href="/chat">
              <MessageSquare className="size-4" />
              Open chat
            </Link>
          </Button>
        </div>

        <div className="grid items-start gap-12 lg:grid-cols-5 lg:gap-16">
          <section className="space-y-8 lg:col-span-3">
            <div className="space-y-2">
              <h2 className="font-display text-2xl font-medium tracking-tight">
                Upload a document
              </h2>
              <p className="text-base text-muted-foreground">
                PDFs work best right now. Upload uses a presigned URL — bytes go
                straight to storage.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="file" className="text-sm font-semibold">
                Choose file
              </Label>
              <Input
                id="file"
                type="file"
                accept=".pdf,application/pdf,image/*"
                className="h-12 cursor-pointer border-input bg-muted/40 pr-3 file:mr-4 file:h-full file:cursor-pointer file:rounded-md file:border-0 file:bg-primary file:px-4 file:text-sm file:font-semibold file:text-primary-foreground file:transition-colors hover:file:bg-primary/90"
                onChange={(e) => {
                  const selected = e.target.files?.[0]
                  setDocumentId(null)
                  setStatus("")
                  setFile(selected ?? null)
                }}
              />
            </div>

            {file && previewUrl && (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{file.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatBytes(file.size)}
                        {file.type ? ` · ${file.type}` : ""}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={clearFile}
                    aria-label="Remove selected file"
                  >
                    <X className="size-4" />
                  </Button>
                </div>

                {isPdf ? (
                  <iframe
                    title={`Preview of ${file.name}`}
                    src={previewUrl}
                    className="h-[28rem] w-full rounded-md border-0 bg-muted/20"
                  />
                ) : isImage ? (
                  <div className="flex max-h-[28rem] items-center justify-center bg-muted/10 p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewUrl}
                      alt={`Preview of ${file.name}`}
                      className="max-h-[26rem] max-w-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
                    <FileText className="size-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      Preview isn&apos;t available for this file type, but it is
                      ready to upload.
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <Button
                onClick={handleUpload}
                disabled={!file || uploading}
                className="h-11 px-6 text-base font-semibold"
              >
                {uploading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Uploading…
                  </>
                ) : (
                  <>
                    <Upload className="size-4" />
                    Submit file
                  </>
                )}
              </Button>

              {documentId && (
                <Button
                  variant="outline"
                  onClick={() => handleDownload()}
                  className="h-11 px-6 text-base"
                >
                  <Download className="size-4" />
                  Download file
                </Button>
              )}
            </div>

            {status && (
              <div className="space-y-1">
                <p className="text-sm font-semibold">Status</p>
                <p
                  className={
                    status.toLowerCase().includes("failed")
                      ? "text-sm font-medium text-destructive"
                      : status === "Upload complete."
                        ? "text-sm font-medium text-foreground"
                        : "text-sm text-muted-foreground"
                  }
                >
                  {status}
                </p>
                {documentId && (
                  <p className="font-mono text-xs text-muted-foreground">
                    documentId: {documentId}
                  </p>
                )}
              </div>
            )}
          </section>

          <aside className="self-start lg:col-span-2 lg:sticky lg:top-20">
            <h2 className="font-display text-2xl font-medium tracking-tight">
              Pipeline
            </h2>
            <p className="mt-1 text-base text-muted-foreground">
              What happens after you upload.
            </p>
            <ol className="mt-8 space-y-6">
              {pipeline.map((item) => (
                <li key={item.step} className="flex gap-4">
                  <span className="font-mono text-sm font-medium text-muted-foreground">
                    {item.step}
                  </span>
                  <div>
                    <p className="font-semibold leading-none">{item.title}</p>
                    <p className="mt-1.5 text-sm text-muted-foreground">
                      {item.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </aside>
        </div>

        {/* Documents library */}
        <section className="mt-20 space-y-6 border-t pt-12">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-3xl font-medium tracking-tight">
                Your documents
              </h2>
              <p className="mt-1 text-base text-muted-foreground">
                Everything you&apos;ve uploaded to organizational memory.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchDocuments()}
              disabled={docsLoading}
            >
              <RefreshCw
                className={cn("size-3.5", docsLoading && "animate-spin")}
              />
              Refresh
            </Button>
          </div>

          {docsLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading documents…
            </div>
          )}

          {!docsLoading && docsError && (
            <p className="text-sm font-medium text-destructive">{docsError}</p>
          )}

          {!docsLoading && !docsError && documents.length === 0 && (
            <p className="text-base text-muted-foreground">
              No documents yet. Upload a file above to get started.
            </p>
          )}

          {!docsLoading && documents.length > 0 && (
            <ul className="divide-y border-y">
              {documents.map((doc) => (
                <li
                  key={doc.id}
                  className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <FileText className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{doc.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(doc.createdAt)}
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {doc.id}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 sm:pl-4">
                    <Badge variant={statusVariant(doc.status)}>
                      {doc.status}
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleDownload(doc.id)}
                    >
                      <Download className="size-3.5" />
                      Download
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}
