"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import {
  AudioLines,
  ChevronDown,
  Download,
  FileText,
  Film,
  ImageIcon,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react"

import { ThemeToggle } from "@/components/theme-toggle"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getErrorMessage } from "@/lib/api"
import {
  deleteDocument,
  fetchDocumentsPage,
  getDownloadUrl,
  uploadDocument,
  type DocStatus,
  type DocumentItem,
} from "@/lib/api/documents"
import { searchDocuments } from "@/lib/api/search"
import { queryKeys } from "@/lib/query-keys"
import { cn } from "@/lib/utils"

type DashboardTab = "upload" | "search" | "chat"

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

function statusLabel(status: DocStatus): string {
  switch (status) {
    case "UPLOADED":
      return "Uploaded"
    case "QUEUED":
      return "Queued"
    case "PARSING":
      return "Parsing"
    case "PARSED":
      return "Parsed"
    case "EMBEDDING":
      return "Embedding"
    case "INDEXED":
      return "Indexed"
    case "READY":
      return "Ready"
    case "FAILED":
      return "Failed"
    default:
      return status
  }
}

function statusVariant(
  status: DocStatus
): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "READY":
      return "default"
    case "FAILED":
      return "destructive"
    case "PARSING":
    case "EMBEDDING":
      return "secondary"
    case "UPLOADED":
    case "QUEUED":
    case "PARSED":
    case "INDEXED":
      return "outline"
    default:
      return "outline"
  }
}

function modalityIcon(modality?: string | null) {
  switch ((modality ?? "").toLowerCase()) {
    case "image":
      return ImageIcon
    case "audio":
      return AudioLines
    case "video":
      return Film
    case "pdf":
    default:
      return FileText
  }
}

function scorePercent(score: number) {
  // RRF + tag boost typically lands roughly 0–0.8; map to a soft bar.
  return Math.max(4, Math.min(100, Math.round(score * 120)))
}

const SEARCH_MODALITIES = [
  { value: "", label: "Any", icon: Sparkles },
  { value: "pdf", label: "PDF", icon: FileText },
  { value: "image", label: "Image", icon: ImageIcon },
  { value: "audio", label: "Audio", icon: AudioLines },
  { value: "video", label: "Video", icon: Film },
] as const

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
    title: "Dispatch",
    body: "Dispatcher routes to the correct modality worker.",
  },
  {
    step: "04",
    title: "Parse",
    body: "Modality worker parses content into text chunks.",
  },
  {
    step: "05",
    title: "Embed",
    body: "Embedding worker generates vectors and indexes into Qdrant.",
  },
]

const TABS: {
  id: DashboardTab
  label: string
  icon: typeof Upload
  hint: string
}[] = [
  {
    id: "upload",
    label: "Upload",
    icon: Upload,
    hint: "Add files & manage library",
  },
  {
    id: "search",
    label: "Search",
    icon: Search,
    hint: "Find by meaning or tags",
  },
  {
    id: "chat",
    label: "Chat",
    icon: MessageSquare,
    hint: "Ask your knowledge base",
  },
]

export default function Dashboard() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<DashboardTab>("upload")
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [status, setStatus] = useState("")
  const [uploadTags, setUploadTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<DocumentItem | null>(null)
  const [dragOver, setDragOver] = useState(false)

  // Semantic document search
  const [searchQuery, setSearchQuery] = useState("")
  /** Empty string = any modality */
  const [searchModality, setSearchModality] = useState("")
  const [activeSearch, setActiveSearch] = useState<{
    query: string
    modality: string
  } | null>(null)

  const documentsQuery = useInfiniteQuery({
    queryKey: queryKeys.documents.list(),
    queryFn: ({ pageParam }) => fetchDocumentsPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })

  const documents = useMemo(
    () => documentsQuery.data?.pages.flatMap((p) => p.documents) ?? [],
    [documentsQuery.data]
  )
  const docsLoading = documentsQuery.isLoading
  const docsError = documentsQuery.isError
    ? "Could not load documents. Sign in and try again."
    : ""
  const nextCursor =
    documentsQuery.data?.pages.at(-1)?.nextCursor ?? null
  const loadingMore = documentsQuery.isFetchingNextPage

  const searchQueryResult = useInfiniteQuery({
    queryKey: queryKeys.search.results(
      activeSearch?.query ?? "",
      activeSearch?.modality ?? ""
    ),
    queryFn: ({ pageParam }) =>
      searchDocuments({
        query: activeSearch!.query,
        offset: pageParam,
        modality: activeSearch!.modality || undefined,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore && lastPage.nextOffset != null
        ? lastPage.nextOffset
        : undefined,
    enabled: Boolean(activeSearch?.query),
  })

  const searchResults = useMemo(
    () => searchQueryResult.data?.pages.flatMap((p) => p.documents) ?? [],
    [searchQueryResult.data]
  )
  const searchLoading = searchQueryResult.isLoading || searchQueryResult.isFetching
  const searchLoadingMore = searchQueryResult.isFetchingNextPage
  const searchError = searchQueryResult.isError
    ? getErrorMessage(searchQueryResult.error, "Search failed")
    : ""
  const searchHasMore = Boolean(searchQueryResult.hasNextPage)
  const searchTotal =
    searchQueryResult.data?.pages[0]?.totalMatched ?? searchResults.length
  const hasSearched = activeSearch !== null
  // Only show full-page spinner on the first page of a search, not on load-more
  const searchInitialLoading =
    Boolean(activeSearch) &&
    searchQueryResult.isFetching &&
    !searchQueryResult.isFetchingNextPage &&
    !searchQueryResult.data

  const uploadMutation = useMutation({
    mutationFn: async ({
      file,
      tags,
    }: {
      file: File
      tags: string[]
    }) => uploadDocument(file, tags, setStatus),
    onSuccess: () => {
      setFile(null)
      setUploadTags([])
      setTagDraft("")
      setStatus("Upload complete.")
      void queryClient.invalidateQueries({ queryKey: queryKeys.documents.all })
    },
    onError: () => {
      setStatus("Upload failed.")
    },
  })
  const uploading = uploadMutation.isPending

  const downloadMutation = useMutation({
    mutationFn: (key: string) => getDownloadUrl(key),
    onSuccess: (url) => {
      window.open(url, "_blank")
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDocument(id),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.documents.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.search.all })
      // Optimistically drop from search cache pages if present
      queryClient.setQueriesData(
        { queryKey: queryKeys.search.all },
        (old: unknown) => {
          if (!old || typeof old !== "object" || !("pages" in old)) return old
          const data = old as {
            pages: { documents: DocumentItem[] }[]
            pageParams: unknown[]
          }
          return {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              documents: page.documents.filter((d) => d.id !== id),
            })),
          }
        }
      )
      setDeleteTarget(null)
    },
    onError: (e) => {
      setDeleteTarget(null)
      console.error(`[dashboard:delete]`, e)
    },
  })
  const deletingId = deleteMutation.isPending
    ? (deleteMutation.variables ?? null)
    : null

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }

    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const addTag = (raw: string) => {
    const parts = raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
    if (parts.length === 0) return
    setUploadTags((prev) => {
      const seen = new Set(prev.map((t) => t.toLowerCase()))
      const next = [...prev]
      for (const p of parts) {
        const key = p.toLowerCase()
        if (seen.has(key) || next.length >= 20) continue
        if (p.length > 40) continue
        seen.add(key)
        next.push(p)
      }
      return next
    })
    setTagDraft("")
  }

  const removeTag = (tag: string) => {
    setUploadTags((prev) => prev.filter((t) => t !== tag))
  }

  const clearFile = () => {
    setFile(null)
    setStatus("")
    setUploadTags([])
    setTagDraft("")
  }

  const pickFile = (selected: File | null | undefined) => {
    setStatus("")
    setFile(selected ?? null)
  }

  const handleUpload = () => {
    if (!file || uploading) return
    uploadMutation.mutate({ file, tags: uploadTags })
  }

  const runSearch = () => {
    const q = searchQuery.trim()
    if (!q) return
    const next = { query: q, modality: searchModality }
    setActiveSearch(next)
    // Re-run even if the same query key is already cached
    void queryClient.invalidateQueries({
      queryKey: queryKeys.search.results(next.query, next.modality),
    })
  }

  const loadMoreSearch = () => {
    if (searchHasMore && !searchLoadingMore && !searchInitialLoading) {
      void searchQueryResult.fetchNextPage()
    }
  }

  const loadMore = () => {
    if (nextCursor && !loadingMore) void documentsQuery.fetchNextPage()
  }

  const handleDownload = (key: string) => {
    downloadMutation.mutate(key)
  }

  const confirmDeleteDocument = () => {
    if (!deleteTarget || deleteMutation.isPending) return
    deleteMutation.mutate(deleteTarget.id)
  }

  const fetchDocuments = () => {
    void documentsQuery.refetch()
  }

  const isPdf =
    file?.type === "application/pdf" || file?.name.toLowerCase().endsWith(".pdf")
  const isImage = Boolean(file?.type.startsWith("image/"))
  const isAudio = Boolean(file?.type.startsWith("audio/"))
  const isVideo = Boolean(file?.type.startsWith("video/"))

  const readyCount = documents.filter((d) => d.status === "READY").length

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b border-border/80 bg-background/75 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/dashboard" className="flex items-center gap-2.5 tracking-tight">
            <span className="font-display text-lg font-medium tracking-tight">
              RecallOS
            </span>
          </Link>

          <nav className="flex items-center gap-1 sm:gap-2">
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main className="relative mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <div className="archive-grid pointer-events-none absolute inset-x-0 top-0 h-72 opacity-25" />

        {/* Hero */}
        <div className="relative mb-10 flex max-w-2xl flex-col gap-5 sm:mb-12 sm:max-w-none sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <p className="mb-3 font-mono text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
              Library
            </p>
            <h1 className="font-display text-5xl leading-[1.05] font-medium tracking-tight text-foreground sm:text-6xl md:text-7xl">
              Dashboard
            </h1>
            <p className="mt-4 max-w-xl text-lg text-muted-foreground">
              {activeTab === "upload" ? (
                <>
                  Build{" "}
                  <span className="font-script text-2xl text-foreground">
                    searchable memory
                  </span>
                  . Upload files, tag them, and watch the pipeline index
                  everything.
                </>
              ) : (
                <>
                  Ask in plain language — hybrid retrieval finds the right docs
                  across{" "}
                  <span className="font-script text-2xl text-foreground">
                    every modality
                  </span>
                  .
                </>
              )}
            </p>
          </div>
          {documents.length > 0 && (
            <div className="hidden items-center gap-2 rounded-full border border-border/70 bg-card/70 px-3 py-1.5 text-xs text-muted-foreground sm:flex">
              <span className="font-mono tabular-nums text-foreground">
                {documents.length}
                {nextCursor ? "+" : ""}
              </span>
              docs
              <span className="text-border">·</span>
              <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                {readyCount}
              </span>
              ready
            </div>
          )}
        </div>

        {/* Section switcher */}
        <div className="relative mb-10">
          <div
            className="flex items-center gap-5 sm:gap-7"
            role="tablist"
            aria-label="Dashboard section"
          >
            {TABS.map((tab) => {
              const Icon = tab.icon
              const active = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    if (tab.id === "chat") {
                      router.push("/chat")
                      return
                    }
                    setActiveTab(tab.id)
                  }}
                  className={cn(
                    "relative inline-flex items-center gap-1.5 pb-2.5 text-sm transition-colors",
                    active
                      ? "font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="size-3.5" />
                  {tab.label}
                  {active && (
                    <span
                      className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-foreground"
                      aria-hidden
                    />
                  )}
                </button>
              )
            })}
          </div>
          <div className="h-px w-full bg-border/70" />
        </div>

        {/* ───────── Upload section ───────── */}
        {activeTab === "upload" && (
          <div className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
            <div className="grid items-start gap-10 lg:grid-cols-5 lg:gap-12">
              <section className="space-y-6 lg:col-span-3">
                <div className="space-y-1.5">
                  <h2 className="font-display text-2xl font-medium tracking-tight">
                    Upload a document
                  </h2>
                  <p className="text-base text-muted-foreground">
                    PDFs, images, audio, and video. Bytes go straight to storage
                    via presigned URL. Tags improve retrieval.
                  </p>
                </div>

                {/* Drop zone */}
                <label
                  htmlFor="file"
                  onDragEnter={(e) => {
                    e.preventDefault()
                    setDragOver(true)
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragOver(true)
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault()
                    setDragOver(false)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragOver(false)
                    const dropped = e.dataTransfer.files?.[0]
                    if (dropped) pickFile(dropped)
                  }}
                  className={cn(
                    "group relative flex cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-all",
                    dragOver
                      ? "border-primary bg-primary/5 shadow-inner"
                      : "border-border/80 bg-card/40 hover:border-primary/40 hover:bg-card/70",
                    file && "border-solid border-border/70 bg-card/60 py-6"
                  )}
                >
                  <div className="archive-grid pointer-events-none absolute inset-0 opacity-20" />
                  {!file ? (
                    <>
                      <span className="relative flex size-14 items-center justify-center rounded-2xl border border-border/80 bg-background/80 shadow-sm">
                        <Upload className="size-6 text-muted-foreground transition-colors group-hover:text-foreground" />
                      </span>
                      <div className="relative space-y-1">
                        <p className="text-base font-medium tracking-tight">
                          Drop a file here, or{" "}
                          <span className="text-foreground underline decoration-border underline-offset-4">
                            browse
                          </span>
                        </p>
                        <p className="text-sm text-muted-foreground">
                          PDF · image · audio · video
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="relative flex w-full items-start justify-between gap-3 text-left">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/8">
                          <FileText className="size-5 text-muted-foreground" />
                        </span>
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
                        className="relative z-10 shrink-0"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          clearFile()
                        }}
                        aria-label="Remove selected file"
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  )}
                  <input
                    id="file"
                    type="file"
                    accept=".pdf,application/pdf,image/*,audio/*,video/*"
                    className="sr-only"
                    onChange={(e) => pickFile(e.target.files?.[0])}
                  />
                </label>

                {/* Preview */}
                {file && previewUrl && (
                  <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/50">
                    {isPdf ? (
                      <iframe
                        title={`Preview of ${file.name}`}
                        src={previewUrl}
                        className="h-[26rem] w-full border-0 bg-muted/20"
                      />
                    ) : isImage ? (
                      <div className="flex max-h-[26rem] items-center justify-center bg-muted/10 p-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={previewUrl}
                          alt={`Preview of ${file.name}`}
                          className="max-h-[24rem] max-w-full rounded-lg object-contain"
                        />
                      </div>
                    ) : isVideo ? (
                      <video
                        src={previewUrl}
                        controls
                        className="max-h-[26rem] w-full bg-muted/10"
                      />
                    ) : isAudio ? (
                      <div className="flex h-24 items-center justify-center bg-muted/10 px-4">
                        <audio
                          src={previewUrl}
                          controls
                          className="w-full max-w-md"
                        />
                      </div>
                    ) : (
                      <div className="flex h-32 flex-col items-center justify-center gap-2 text-center">
                        <FileText className="size-8 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                          Preview isn&apos;t available for this type — ready to
                          upload.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Tags */}
                <div className="space-y-2.5 rounded-2xl border border-border/80 bg-card/50 p-5">
                  <Label htmlFor="tags" className="text-sm font-semibold">
                    Tags{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </Label>
                  {uploadTags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {uploadTags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="secondary"
                          className="gap-1 pr-1 font-normal"
                        >
                          {tag}
                          <button
                            type="button"
                            className="rounded-sm p-0.5 hover:bg-muted"
                            onClick={() => removeTag(tag)}
                            aria-label={`Remove tag ${tag}`}
                          >
                            <X className="size-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                  <Input
                    id="tags"
                    type="text"
                    value={tagDraft}
                    placeholder="e.g. paris, trip, resume — Enter or comma to add"
                    className="h-11 border-input bg-background/60"
                    disabled={uploadTags.length >= 20}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault()
                        addTag(tagDraft)
                      } else if (
                        e.key === "Backspace" &&
                        !tagDraft &&
                        uploadTags.length > 0
                      ) {
                        removeTag(uploadTags[uploadTags.length - 1]!)
                      }
                    }}
                    onBlur={() => {
                      if (tagDraft.trim()) addTag(tagDraft)
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Up to 20 tags. Stored on the document and embedded with every
                    chunk.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
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
                  {status && (
                    <p
                      className={cn(
                        "text-sm font-medium",
                        status.toLowerCase().includes("failed")
                          ? "text-destructive"
                          : status === "Upload complete."
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-muted-foreground"
                      )}
                    >
                      {status}
                    </p>
                  )}
                </div>
              </section>

              <aside className="memory-glow self-start rounded-2xl border border-border/80 bg-card/80 p-6 lg:sticky lg:top-20 lg:col-span-2">
                <p className="font-mono text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
                  After upload
                </p>
                <h2 className="mt-1 font-display text-2xl font-medium tracking-tight">
                  Pipeline
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  What happens once the file lands.
                </p>
                <ol className="mt-7 space-y-0">
                  {pipeline.map((item, index) => (
                    <li
                      key={item.step}
                      className="relative flex gap-4 pb-6 last:pb-0"
                    >
                      {index < pipeline.length - 1 && (
                        <span
                          className="absolute top-6 bottom-0 left-[0.55rem] w-px bg-border"
                          aria-hidden
                        />
                      )}
                      <span className="relative z-10 flex size-5 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 font-mono text-[10px] font-semibold text-muted-foreground">
                        {index + 1}
                      </span>
                      <div>
                        <p className="font-medium leading-none tracking-tight">
                          {item.title}
                        </p>
                        <p className="mt-1.5 text-sm text-muted-foreground">
                          {item.body}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </aside>
            </div>

            {/* Documents library — upload section only */}
            <section className="mt-16 space-y-6 border-t border-border/70 pt-12">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="mb-1.5 font-mono text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
                    Library
                  </p>
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
                  className="border-border/90 bg-card/60"
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
                <div className="rounded-2xl border border-dashed border-border/90 bg-card/40 px-6 py-14 text-center">
                  <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl border border-border/80 bg-background">
                    <FileText className="size-5 text-muted-foreground" />
                  </span>
                  <p className="font-display text-xl text-foreground">
                    No documents yet
                  </p>
                  <p className="mt-2 text-base text-muted-foreground">
                    Drop a file above to start building memory.
                  </p>
                </div>
              )}

              {!docsLoading && documents.length > 0 && (
                <>
                  <ul className="space-y-2.5">
                    {documents.map((doc) => {
                      const Icon = modalityIcon(doc.modality)
                      return (
                        <li
                          key={doc.id}
                          className={cn(
                            "group flex flex-col gap-3 rounded-2xl border border-border/80 bg-card/60 px-4 py-4 transition-colors sm:flex-row sm:items-center sm:justify-between sm:px-5",
                            "hover:border-border hover:bg-card/90",
                            doc.status === "READY" &&
                              "border-l-[3px] border-l-emerald-500/50",
                            (doc.status === "PARSING" ||
                              doc.status === "EMBEDDING") &&
                              "border-l-[3px] border-l-muted-foreground/35",
                            doc.status === "FAILED" &&
                              "border-l-[3px] border-l-red-500/50 bg-red-500/[0.04]",
                            (doc.status === "UPLOADED" ||
                              doc.status === "QUEUED" ||
                              doc.status === "PARSED" ||
                              doc.status === "INDEXED") &&
                              "border-dashed"
                          )}
                        >
                          <div className="flex min-w-0 items-start gap-3">
                            <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/12 bg-primary/[0.06] text-muted-foreground">
                              <Icon className="size-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-medium tracking-tight">
                                {doc.title}
                              </p>
                              <p className="mt-0.5 text-sm text-muted-foreground">
                                {formatDate(doc.createdAt)}
                                {doc.modality ? (
                                  <span className="text-border"> · </span>
                                ) : null}
                                {doc.modality && (
                                  <span className="font-mono text-xs uppercase tracking-wide">
                                    {doc.modality}
                                  </span>
                                )}
                              </p>
                              {(doc.tags?.length ?? 0) > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {doc.tags!.map((tag) => (
                                    <Badge
                                      key={tag}
                                      variant="secondary"
                                      className="font-normal"
                                    >
                                      {tag}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2 sm:pl-4">
                            <Badge variant={statusVariant(doc.status)}>
                              {statusLabel(doc.status)}
                            </Badge>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void handleDownload(doc.ObjectKey)}
                            >
                              <Download className="size-3.5" />
                              Download
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              disabled={deletingId === doc.id}
                              onClick={() => setDeleteTarget(doc)}
                            >
                              {deletingId === doc.id ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="size-3.5" />
                              )}
                              Delete
                            </Button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                  {nextCursor && (
                    <div className="flex justify-center pt-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={loadMore}
                        disabled={loadingMore}
                        className="gap-1.5 text-muted-foreground hover:text-foreground"
                      >
                        {loadingMore ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <ChevronDown className="size-3.5" />
                        )}
                        Load more
                      </Button>
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        )}

        {/* ───────── Search section ───────── */}
        {activeTab === "search" && (
          <div className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
            <section className="mx-auto max-w-3xl space-y-8">
              <div className="text-center">
                <p className="mb-2 font-mono text-[10px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
                  Hybrid retrieval
                </p>
                <h2 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">
                  Search your{" "}
                  <span className="font-script">memory</span>
                </h2>
                <p className="mx-auto mt-2 max-w-md text-base text-muted-foreground">
                  Dense + sparse vectors fused with RRF. Filter by type when you
                  know what you want.
                </p>
              </div>

              <form
                className="memory-glow space-y-5 rounded-2xl border border-border/80 bg-card/80 p-5 sm:p-6"
                onSubmit={(e) => {
                  e.preventDefault()
                  runSearch()
                }}
              >
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="pics from my trip to paris…"
                    className="h-14 border-input bg-background/70 pl-12 pr-4 text-base shadow-none sm:text-lg"
                    disabled={searchInitialLoading}
                    autoFocus
                  />
                </div>

                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div
                    className="flex flex-wrap gap-1.5"
                    role="group"
                    aria-label="Filter by document type"
                  >
                    {SEARCH_MODALITIES.map((m) => {
                      const active = searchModality === m.value
                      const Icon = m.icon
                      return (
                        <button
                          key={m.value || "any"}
                          type="button"
                          disabled={searchInitialLoading}
                          onClick={() => setSearchModality(m.value)}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-all",
                            active
                              ? "border-primary bg-primary text-primary-foreground shadow-sm"
                              : "border-border/80 bg-background/50 text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground",
                            searchInitialLoading && "opacity-60"
                          )}
                          aria-pressed={active}
                        >
                          <Icon className="size-3.5" />
                          {m.label}
                        </button>
                      )
                    })}
                  </div>

                  <Button
                    type="submit"
                    disabled={!searchQuery.trim() || searchInitialLoading}
                    className="h-11 shrink-0 px-6 text-base font-semibold sm:min-w-[8.5rem]"
                  >
                    {searchInitialLoading ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Searching…
                      </>
                    ) : (
                      <>
                        <Search className="size-4" />
                        Search
                      </>
                    )}
                  </Button>
                </div>
              </form>

              {searchInitialLoading && (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Running hybrid retrieval</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Dense · sparse · RRF fusion
                      {searchModality ? ` · ${searchModality} only` : ""}
                    </p>
                  </div>
                </div>
              )}

              {!searchInitialLoading && searchError && (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-5 py-4 text-center">
                  <p className="text-sm font-medium text-destructive">
                    {searchError}
                  </p>
                </div>
              )}

              {!searchInitialLoading && !hasSearched && (
                <div className="rounded-2xl border border-dashed border-border/80 bg-card/30 px-6 py-14 text-center">
                  <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl border border-border/80 bg-background">
                    <Sparkles className="size-5 text-muted-foreground" />
                  </span>
                  <p className="font-display text-xl text-foreground">
                    Try a natural query
                  </p>
                  <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                    e.g. &ldquo;quarterly revenue notes&rdquo; or &ldquo;beach
                    photos from italy&rdquo;
                  </p>
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    {[
                      "pics from my trip to paris",
                      "resume pdf",
                      "meeting audio notes",
                    ].map((example) => (
                      <button
                        key={example}
                        type="button"
                        onClick={() => {
                          setSearchQuery(example)
                        }}
                        className="rounded-full border border-border/80 bg-card/60 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground"
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!searchInitialLoading &&
                hasSearched &&
                !searchError &&
                searchResults.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-border/90 bg-card/40 px-6 py-14 text-center">
                    <p className="font-display text-xl text-foreground">
                      No matching documents
                    </p>
                    <p className="mt-2 text-base text-muted-foreground">
                      Try different wording, clear the type filter, or wait until
                      uploads show Ready.
                    </p>
                  </div>
                )}

              {!searchInitialLoading && searchResults.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm text-muted-foreground">
                      <span className="font-mono tabular-nums text-foreground">
                        {searchResults.length}
                      </span>
                      {searchTotal > 0 ? (
                        <>
                          {" "}
                          of{" "}
                          <span className="font-mono tabular-nums text-foreground">
                            {searchTotal}
                          </span>
                        </>
                      ) : null}{" "}
                      related document
                      {searchTotal === 1 ? "" : "s"}
                      {searchModality ? (
                        <span className="text-muted-foreground">
                          {" "}
                          ·{" "}
                          <span className="font-mono text-xs uppercase">
                            {searchModality}
                          </span>
                        </span>
                      ) : null}
                    </p>
                  </div>

                  <ul className="space-y-3">
                    {searchResults.map((doc, idx) => {
                      const Icon = modalityIcon(doc.modality)
                      const pct = scorePercent(doc.score)
                      return (
                        <li
                          key={`${doc.id}-${idx}`}
                          className="group overflow-hidden rounded-2xl border border-border/80 bg-card/70 transition-all hover:border-border hover:bg-card hover:shadow-[0_8px_30px_-18px_color-mix(in_oklch,var(--foreground)_18%,transparent)]"
                        >
                          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
                            <div className="flex min-w-0 flex-1 items-start gap-3.5">
                              <span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-xl border border-primary/12 bg-primary/[0.06] text-muted-foreground">
                                <Icon className="size-4" />
                              </span>
                              <div className="min-w-0 flex-1 space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="truncate font-medium tracking-tight">
                                    {doc.title}
                                  </p>
                                  {doc.modality && (
                                    <Badge
                                      variant="outline"
                                      className="font-mono text-[10px] uppercase"
                                    >
                                      {doc.modality}
                                    </Badge>
                                  )}
                                </div>
                                {doc.snippet && (
                                  <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                                    {doc.snippet}
                                  </p>
                                )}
                                {(doc.tags ?? []).length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {(doc.tags ?? []).map((tag) => (
                                      <Badge
                                        key={tag}
                                        variant="secondary"
                                        className="font-normal"
                                      >
                                        {tag}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                                <div className="flex items-center gap-2.5 pt-0.5">
                                  <div className="h-1.5 max-w-[7rem] flex-1 overflow-hidden rounded-full bg-muted">
                                    <div
                                      className="h-full rounded-full bg-foreground/70 transition-all"
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                  <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                                    {doc.score.toFixed(3)}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2 sm:pl-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void handleDownload(doc.ObjectKey)}
                              >
                                <Download className="size-3.5" />
                                Download
                              </Button>
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>

                  {searchHasMore && (
                    <div className="flex justify-center pt-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={loadMoreSearch}
                        disabled={searchLoadingMore}
                        className="gap-1.5 text-muted-foreground hover:text-foreground"
                      >
                        {searchLoadingMore ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <ChevronDown className="size-3.5" />
                        )}
                        Load more
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete document?</DialogTitle>
            <DialogDescription>
              {`Delete "${deleteTarget?.title}"? This removes it from the queue (even if processing), storage, and search index. This cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!!deletingId}
              onClick={() => void confirmDeleteDocument()}
            >
              {deletingId ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
