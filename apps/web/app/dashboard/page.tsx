"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
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
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { getErrorMessage } from "@/lib/api";
import {
  deleteDocument,
  fetchDocumentsPage,
  getDownloadUrl,
  uploadDocument,
  type DocStatus,
  type DocumentItem,
} from "@/lib/api/documents";
import { searchDocuments } from "@/lib/api/search";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

type DashboardTab = "upload" | "search" | "chat";

const MAX_BATCH_FILES = 20;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function isAcceptedUploadFile(file: File): boolean {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return true;
  if (file.type.startsWith("image/")) return true;
  if (file.type.startsWith("audio/")) return true;
  if (file.type.startsWith("video/")) return true;
  // Some browsers leave type empty for certain files — fall back to extension
  if (/\.(png|jpe?g|gif|webp|bmp|svg|tiff?|mp3|wav|m4a|aac|ogg|flac|mp4|webm|mov|mkv|avi)$/i.test(name)) {
    return true;
  }
  return false;
}

function fileKey(file: File): string {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusLabel(status: DocStatus): string {
  switch (status) {
    case "UPLOADED":
      return "Uploaded";
    case "QUEUED":
      return "Queued";
    case "PARSING":
      return "Parsing";
    case "PARSED":
      return "Parsed";
    case "EMBEDDING":
      return "Embedding";
    case "INDEXED":
      return "Indexed";
    case "READY":
      return "Ready";
    case "FAILED":
      return "Failed";
    default:
      return status;
  }
}

function statusVariant(
  status: DocStatus,
): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "READY":
      return "default";
    case "FAILED":
      return "destructive";
    case "PARSING":
    case "EMBEDDING":
      return "secondary";
    case "UPLOADED":
    case "QUEUED":
    case "PARSED":
    case "INDEXED":
      return "outline";
    default:
      return "outline";
  }
}

function modalityIcon(modality?: string | null) {
  switch ((modality ?? "").toLowerCase()) {
    case "image":
      return ImageIcon;
    case "audio":
      return AudioLines;
    case "video":
      return Film;
    case "pdf":
    default:
      return FileText;
  }
}

function scorePercent(score: number) {
  // RRF + tag boost typically lands roughly 0–0.8; map to a soft bar.
  return Math.max(4, Math.min(100, Math.round(score * 120)));
}

const SEARCH_MODALITIES = [
  { value: "", label: "Any", icon: Sparkles },
  { value: "pdf", label: "PDF", icon: FileText },
  { value: "image", label: "Image", icon: ImageIcon },
  { value: "audio", label: "Audio", icon: AudioLines },
  { value: "video", label: "Video", icon: Film },
] as const;

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
];

const TABS: {
  id: DashboardTab;
  label: string;
  icon: typeof Upload;
  hint: string;
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
];

function DocumentRowSkeleton() {
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-border bg-card px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="flex min-w-0 items-start gap-3">
        <Skeleton className="mt-0.5 size-10 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-2 pt-0.5">
          <Skeleton className="h-4 w-48 max-w-full" />
          <Skeleton className="h-3.5 w-32 max-w-[70%]" />
          <div className="flex gap-1.5 pt-0.5">
            <Skeleton className="h-5 w-14 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:pl-4">
        <Skeleton className="h-6 w-16 rounded-full" />
        <Skeleton className="h-8 w-[5.5rem] rounded-md" />
        <Skeleton className="h-8 w-[4.5rem] rounded-md" />
      </div>
    </li>
  );
}

function DocumentListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <ul className="space-y-2.5" aria-busy="true" aria-label="Loading documents">
      {Array.from({ length: count }, (_, i) => (
        <DocumentRowSkeleton key={i} />
      ))}
    </ul>
  );
}

function SearchResultSkeleton() {
  return (
    <li className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div className="flex min-w-0 flex-1 items-start gap-3.5">
          <Skeleton className="mt-0.5 size-11 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-4 w-40 max-w-[60%]" />
              <Skeleton className="h-5 w-12 rounded-full" />
            </div>
            <Skeleton className="h-3.5 w-full max-w-md" />
            <Skeleton className="h-3.5 w-3/4 max-w-sm" />
            <div className="flex gap-1.5 pt-0.5">
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="mt-1 h-1.5 w-28 rounded-full" />
          </div>
        </div>
        <Skeleton className="h-8 w-[5.5rem] shrink-0 rounded-md" />
      </div>
    </li>
  );
}

function SearchListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <ul className="space-y-3" aria-busy="true" aria-label="Searching documents">
      {Array.from({ length: count }, (_, i) => (
        <SearchResultSkeleton key={i} />
      ))}
    </ul>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<DashboardTab>("upload");
  const [files, setFiles] = useState<File[]>([]);
  const filesRef = useRef(files);
  filesRef.current = files;
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [uploadTags, setUploadTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DocumentItem | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Semantic document search
  const [searchQuery, setSearchQuery] = useState("");
  /** Empty string = any modality */
  const [searchModality, setSearchModality] = useState("");
  const [activeSearch, setActiveSearch] = useState<{
    query: string;
    modality: string;
  } | null>(null);

  const documentsQuery = useInfiniteQuery({
    queryKey: queryKeys.documents.list(),
    queryFn: ({ pageParam }) => fetchDocumentsPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    // Always consider docs stale so uploads / pipeline status show up promptly
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    // Auto-poll while any document is still processing (no manual refresh needed)
    refetchInterval: (query) => {
      const pages = query.state.data?.pages;
      if (!pages?.length) return false;
      const busy = pages.some((page) =>
        page.documents.some(
          (d) => d.status !== "READY" && d.status !== "FAILED",
        ),
      );
      return busy ? 2_500 : false;
    },
    refetchIntervalInBackground: false,
  });

  const documents = useMemo(
    () => documentsQuery.data?.pages.flatMap((p) => p.documents) ?? [],
    [documentsQuery.data],
  );

  const hasProcessingDocs = useMemo(
    () => documents.some((d) => d.status !== "READY" && d.status !== "FAILED"),
    [documents],
  );

  const docsLoading = documentsQuery.isLoading;
  /** Background refresh (refresh click, poll, post-upload) while list is already shown */
  const docsRefreshing =
    documentsQuery.isFetching &&
    !documentsQuery.isLoading &&
    !documentsQuery.isFetchingNextPage;
  const docsError = documentsQuery.isError
    ? "Could not load documents. Sign in and try again."
    : "";
  const nextCursor = documentsQuery.data?.pages.at(-1)?.nextCursor ?? null;
  const loadingMore = documentsQuery.isFetchingNextPage;

  const searchQueryResult = useInfiniteQuery({
    queryKey: queryKeys.search.results(
      activeSearch?.query ?? "",
      activeSearch?.modality ?? "",
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
  });

  const searchResults = useMemo(
    () => searchQueryResult.data?.pages.flatMap((p) => p.documents) ?? [],
    [searchQueryResult.data],
  );
  const searchLoadingMore = searchQueryResult.isFetchingNextPage;
  const searchError = searchQueryResult.isError
    ? getErrorMessage(searchQueryResult.error, "Search failed")
    : "";
  const searchHasMore = Boolean(searchQueryResult.hasNextPage);
  const searchTotal =
    searchQueryResult.data?.pages[0]?.totalMatched ?? searchResults.length;
  const hasSearched = activeSearch !== null;
  // Only show full-page spinner on the first page of a search, not on load-more
  const searchInitialLoading =
    Boolean(activeSearch) &&
    searchQueryResult.isFetching &&
    !searchQueryResult.isFetchingNextPage &&
    !searchQueryResult.data;

  const batchCompletedRef = useRef(0);

  const uploadMutation = useMutation({
    mutationFn: async ({
      files: batch,
      tags,
    }: {
      files: File[];
      tags: string[];
    }) => {
      const total = batch.length;
      batchCompletedRef.current = 0;
      for (let i = 0; i < total; i++) {
        const current = batch[i]!;
        const progress =
          total > 1 ? ` (${i + 1}/${total}: ${current.name})` : "";
        await uploadDocument(current, tags, (step) =>
          setStatus(`${step}${progress}`),
        );
        batchCompletedRef.current = i + 1;
        // Drop successfully uploaded files so a partial failure leaves only retries
        setFiles((prev) =>
          prev.filter((f) => fileKey(f) !== fileKey(current)),
        );
      }
      return { completed: total, total };
    },
    onSuccess: async (result) => {
      setFiles([]);
      setUploadTags([]);
      setTagDraft("");
      setStatus(
        result.total > 1
          ? `Upload complete. ${result.total} files submitted.`
          : "Upload complete.",
      );
      // Force an immediate list refresh so new docs appear without manual refresh
      await queryClient.invalidateQueries({
        queryKey: queryKeys.documents.all,
      });
      await queryClient.refetchQueries({
        queryKey: queryKeys.documents.list(),
      });
    },
    onError: async (err, variables) => {
      const total = variables.files.length;
      const completed = batchCompletedRef.current;
      setStatus(
        total > 1
          ? completed > 0
            ? `Uploaded ${completed} of ${total}, then failed. ${getErrorMessage(err, "Retry the remaining files.")}`
            : `Upload failed. ${getErrorMessage(err, "Please try again.")}`
          : "Upload failed.",
      );
      if (completed > 0) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.documents.all,
        });
        await queryClient.refetchQueries({
          queryKey: queryKeys.documents.list(),
        });
      }
    },
  });
  const uploading = uploadMutation.isPending;

  const downloadMutation = useMutation({
    mutationFn: (key: string) => getDownloadUrl(key),
    onSuccess: (url) => {
      window.open(url, "_blank");
    },
  });
  const downloadingKey = downloadMutation.isPending
    ? (downloadMutation.variables ?? null)
    : null;

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDocument(id),
    onSuccess: async (_data, id) => {
      // Drop from list cache immediately
      queryClient.setQueriesData(
        { queryKey: queryKeys.documents.list() },
        (old: unknown) => {
          if (!old || typeof old !== "object" || !("pages" in old)) return old;
          const data = old as {
            pages: { documents: DocumentItem[]; nextCursor: string | null }[];
            pageParams: unknown[];
          };
          return {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              documents: page.documents.filter((d) => d.id !== id),
            })),
          };
        },
      );
      queryClient.setQueriesData(
        { queryKey: queryKeys.search.all },
        (old: unknown) => {
          if (!old || typeof old !== "object" || !("pages" in old)) return old;
          const data = old as {
            pages: { documents: DocumentItem[] }[];
            pageParams: unknown[];
          };
          return {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              documents: page.documents.filter((d) => d.id !== id),
            })),
          };
        },
      );
      setDeleteTarget(null);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.documents.all,
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.search.all });
    },
    onError: (e) => {
      setDeleteTarget(null);
      console.error(`[dashboard:delete]`, e);
    },
  });
  const deletingId = deleteMutation.isPending
    ? (deleteMutation.variables ?? null)
    : null;

  // Preview the first selected file only (keeps UI simple for multi-select)
  const previewFile = files.length === 1 ? files[0]! : null;

  useEffect(() => {
    if (!previewFile) {
      setPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(previewFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [previewFile]);

  const addTag = (raw: string) => {
    const parts = raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    setUploadTags((prev) => {
      const seen = new Set(prev.map((t) => t.toLowerCase()));
      const next = [...prev];
      for (const p of parts) {
        const key = p.toLowerCase();
        if (seen.has(key) || next.length >= 20) continue;
        if (p.length > 40) continue;
        seen.add(key);
        next.push(p);
      }
      return next;
    });
    setTagDraft("");
  };

  const removeTag = (tag: string) => {
    setUploadTags((prev) => prev.filter((t) => t !== tag));
  };

  const clearFiles = () => {
    setFiles([]);
    setStatus("");
    setUploadTags([]);
    setTagDraft("");
  };

  const removeFileAt = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setStatus("");
  };

  const pickFiles = (selected: FileList | File[] | null | undefined) => {
    if (!selected) return;
    const incoming = Array.from(selected).filter(isAcceptedUploadFile);
    if (incoming.length === 0) {
      setStatus("Only PDF, image, audio, and video files are supported.");
      return;
    }

    const prev = filesRef.current;
    const seen = new Set(prev.map(fileKey));
    const next = [...prev];
    let hitCap = false;
    for (const f of incoming) {
      if (next.length >= MAX_BATCH_FILES) {
        hitCap = true;
        break;
      }
      const key = fileKey(f);
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(f);
    }

    setFiles(next);
    setStatus(hitCap ? `Up to ${MAX_BATCH_FILES} files per batch.` : "");
  };

  const handleUpload = () => {
    if (files.length === 0 || uploading) return;
    uploadMutation.mutate({ files, tags: uploadTags });
  };

  const runSearch = () => {
    const q = searchQuery.trim();
    if (!q) return;
    const next = { query: q, modality: searchModality };
    setActiveSearch(next);
    // Re-run even if the same query key is already cached
    void queryClient.invalidateQueries({
      queryKey: queryKeys.search.results(next.query, next.modality),
    });
  };

  const loadMoreSearch = () => {
    if (searchHasMore && !searchLoadingMore && !searchInitialLoading) {
      void searchQueryResult.fetchNextPage();
    }
  };

  const loadMore = () => {
    if (nextCursor && !loadingMore) void documentsQuery.fetchNextPage();
  };

  const handleDownload = (key: string) => {
    downloadMutation.mutate(key);
  };

  const confirmDeleteDocument = () => {
    if (!deleteTarget || deleteMutation.isPending) return;
    deleteMutation.mutate(deleteTarget.id);
  };

  const fetchDocuments = async () => {
    await documentsQuery.refetch({ cancelRefetch: false });
  };

  const isPdf =
    previewFile?.type === "application/pdf" ||
    Boolean(previewFile?.name.toLowerCase().endsWith(".pdf"));
  const isImage = Boolean(previewFile?.type.startsWith("image/"));
  const isAudio = Boolean(previewFile?.type.startsWith("audio/"));
  const isVideo = Boolean(previewFile?.type.startsWith("video/"));
  const totalSelectedBytes = files.reduce((sum, f) => sum + f.size, 0);

  const readyCount = documents.filter((d) => d.status === "READY").length;

  return (
    <div className="dashboard-stage relative flex min-h-screen flex-col overflow-hidden">
      <div
        className={`page-art page-art--dashboard page-art--dashboard-${activeTab}`}
        aria-hidden
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="page-art-image"
          src={
            activeTab === "search"
              ? "/bg-assets/side.jpeg"
              : "/bg-assets/ATHENA.png"
          }
          alt=""
        />
      </div>
      <header className="sticky top-0 z-50 border-b border-border/80 bg-background/75 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/dashboard"
            className="flex items-center gap-2.5 tracking-tight"
          >
            <span className="font-display text-lg font-medium tracking-tight">
              RecallOS
            </span>
          </Link>

          <nav className="flex items-center gap-1 sm:gap-2"></nav>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
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
                  <span className="font-script text-foreground">
                    searchable memory
                  </span>
                  . Upload files, tag them, and watch the pipeline index
                  everything.
                </>
              ) : (
                <>
                  Ask in plain language — hybrid retrieval finds the right docs
                  across{" "}
                  <span className="font-script text-foreground">
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
              {hasProcessingDocs && (
                <>
                  <span className="text-border">·</span>
                  <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
                    <Loader2 className="size-3 animate-spin" />
                    indexing
                  </span>
                </>
              )}
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
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    if (tab.id === "chat") {
                      router.push("/chat");
                      return;
                    }
                    setActiveTab(tab.id);
                  }}
                  className={cn(
                    "relative inline-flex items-center gap-1.5 pb-2.5 text-sm transition-colors",
                    active
                      ? "font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
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
              );
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
                    Upload documents
                  </h2>
                  <p className="text-base text-muted-foreground">
                    PDFs, images, audio, and video — one or many at a time.
                    Bytes go straight to storage via presigned URL. Tags apply
                    to every file in the batch.
                  </p>
                </div>

                {/* Drop zone */}
                <label
                  htmlFor="file"
                  onDragEnter={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    pickFiles(e.dataTransfer.files);
                  }}
                  className={cn(
                    "group relative flex cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-all",
                    dragOver
                      ? "border-primary bg-primary/5 shadow-inner"
                      : "border-border/80 bg-card/40 hover:border-primary/40 hover:bg-card/70",
                    files.length > 0 &&
                      "border-solid border-border/70 bg-card/60 py-6",
                  )}
                >
                  <div className="archive-grid pointer-events-none absolute inset-0 opacity-20" />
                  {files.length === 0 ? (
                    <>
                      <span className="relative flex size-14 items-center justify-center rounded-2xl border border-border/80 bg-background/80 shadow-sm">
                        <Upload className="size-6 text-muted-foreground transition-colors group-hover:text-foreground" />
                      </span>
                      <div className="relative space-y-1">
                        <p className="text-base font-medium tracking-tight">
                          Drop files here, or{" "}
                          <span className="text-foreground underline decoration-border underline-offset-4">
                            browse
                          </span>
                        </p>
                        <p className="text-sm text-muted-foreground">
                          PDF · image · audio · video — up to {MAX_BATCH_FILES}{" "}
                          files
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="relative w-full space-y-3 text-left">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold">
                            {files.length} file{files.length === 1 ? "" : "s"}{" "}
                            selected
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {formatBytes(totalSelectedBytes)} total · drop or
                            browse to add more
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="relative z-10 shrink-0"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            clearFiles();
                          }}
                        >
                          Clear all
                        </Button>
                      </div>
                      <ul className="max-h-56 space-y-2 overflow-y-auto pr-1">
                        {files.map((f, index) => (
                          <li
                            key={fileKey(f)}
                            className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/70 px-3 py-2"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/8">
                                <FileText className="size-4 text-muted-foreground" />
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">
                                  {f.name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {formatBytes(f.size)}
                                  {f.type ? ` · ${f.type}` : ""}
                                </p>
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="relative z-10 shrink-0"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                removeFileAt(index);
                              }}
                              aria-label={`Remove ${f.name}`}
                            >
                              <X className="size-4" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <input
                    id="file"
                    type="file"
                    multiple
                    accept=".pdf,application/pdf,image/*,audio/*,video/*"
                    className="sr-only"
                    onChange={(e) => {
                      pickFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>

                {/* Preview (single-file selection only) */}
                {previewFile && previewUrl && (
                  <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/50">
                    {isPdf ? (
                      <iframe
                        title={`Preview of ${previewFile.name}`}
                        src={previewUrl}
                        className="h-[26rem] w-full border-0 bg-muted/20"
                      />
                    ) : isImage ? (
                      <div className="flex max-h-[26rem] items-center justify-center bg-muted/10 p-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={previewUrl}
                          alt={`Preview of ${previewFile.name}`}
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
                        e.preventDefault();
                        addTag(tagDraft);
                      } else if (
                        e.key === "Backspace" &&
                        !tagDraft &&
                        uploadTags.length > 0
                      ) {
                        removeTag(uploadTags[uploadTags.length - 1]!);
                      }
                    }}
                    onBlur={() => {
                      if (tagDraft.trim()) addTag(tagDraft);
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Up to 20 tags. Stored on the document and embedded with
                    every chunk.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    onClick={handleUpload}
                    disabled={files.length === 0 || uploading}
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
                        {files.length > 1
                          ? `Submit ${files.length} files`
                          : "Submit file"}
                      </>
                    )}
                  </Button>
                  {status && (
                    <p
                      className={cn(
                        "text-sm font-medium",
                        status.toLowerCase().includes("failed")
                          ? "text-destructive"
                          : status.startsWith("Upload complete")
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-muted-foreground",
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
                  What happens once files land.
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
                  disabled={docsLoading || docsRefreshing}
                  className="border-border/90 bg-card/60"
                  aria-busy={docsLoading || docsRefreshing}
                >
                  <RefreshCw
                    className={cn(
                      "size-3.5",
                      (docsLoading || docsRefreshing) && "animate-spin",
                    )}
                  />
                  {docsLoading || docsRefreshing ? "Refreshing…" : "Refresh"}
                </Button>
              </div>

              {docsLoading && <DocumentListSkeleton count={4} />}

              {!docsLoading && docsRefreshing && (
                <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/70 px-4 py-2.5 text-sm font-medium text-foreground">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  {hasProcessingDocs
                    ? "Updating document status…"
                    : "Refreshing library…"}
                </div>
              )}

              {!docsLoading && docsError && (
                <p className="text-sm font-medium text-destructive">
                  {docsError}
                </p>
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
                    Drop files above to start building memory.
                  </p>
                </div>
              )}

              {!docsLoading && documents.length > 0 && (
                <>
                  <ul
                    className={cn(
                      "space-y-2.5 transition-opacity duration-200",
                      docsRefreshing && "opacity-60",
                    )}
                  >
                    {documents.map((doc) => {
                      const Icon = modalityIcon(doc.modality);
                      const isProcessing =
                        doc.status !== "READY" && doc.status !== "FAILED";
                      return (
                        <li
                          key={doc.id}
                          className={cn(
                            "group flex flex-col gap-3 rounded-2xl border border-border/80 bg-card/60 px-4 py-4 transition-colors sm:flex-row sm:items-center sm:justify-between sm:px-5",
                            "hover:border-border hover:bg-card/90",
                            doc.status === "READY" &&
                              "border-l-[3px] border-l-emerald-500/50",
                            isProcessing &&
                              "border-l-[3px] border-l-muted-foreground/35",
                            doc.status === "FAILED" &&
                              "border-l-[3px] border-l-red-500/50 bg-red-500/[0.04]",
                            (doc.status === "UPLOADED" ||
                              doc.status === "QUEUED" ||
                              doc.status === "PARSED" ||
                              doc.status === "INDEXED") &&
                              "border-dashed",
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
                            <Badge
                              variant={statusVariant(doc.status)}
                              className="gap-1"
                            >
                              {isProcessing && (
                                <Loader2 className="size-3 animate-spin" />
                              )}
                              {statusLabel(doc.status)}
                            </Badge>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={downloadingKey === doc.ObjectKey}
                              onClick={() => void handleDownload(doc.ObjectKey)}
                            >
                              {downloadingKey === doc.ObjectKey ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Download className="size-3.5" />
                              )}
                              {downloadingKey === doc.ObjectKey
                                ? "Opening…"
                                : "Download"}
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
                              {deletingId === doc.id ? "Deleting…" : "Delete"}
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {loadingMore && (
                    <div className="space-y-2.5 pt-1">
                      <DocumentRowSkeleton />
                      <DocumentRowSkeleton />
                    </div>
                  )}
                  {nextCursor && !loadingMore && (
                    <div className="flex justify-center pt-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={loadMore}
                        className="gap-1.5 text-muted-foreground hover:text-foreground"
                      >
                        <ChevronDown className="size-3.5" />
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
                  Search your <span className="font-script">memory</span>
                </h2>
                <p className="mx-auto mt-2 max-w-md text-base text-muted-foreground">
                  Dense + sparse vectors fused with RRF. Filter by type when you
                  know what you want.
                </p>
              </div>

              <form
                className="memory-glow space-y-5 rounded-2xl border border-border/80 bg-card/80 p-5 sm:p-6"
                onSubmit={(e) => {
                  e.preventDefault();
                  runSearch();
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
                      const active = searchModality === m.value;
                      const Icon = m.icon;
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
                            searchInitialLoading && "opacity-60",
                          )}
                          aria-pressed={active}
                        >
                          <Icon className="size-3.5" />
                          {m.label}
                        </button>
                      );
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
                <div className="space-y-4">
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    <span>
                      Running hybrid retrieval
                      {searchModality ? ` · ${searchModality}` : ""}
                    </span>
                  </div>
                  <SearchListSkeleton count={3} />
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
                          setSearchQuery(example);
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
                      Try different wording, clear the type filter, or wait
                      until uploads show Ready.
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
                      const Icon = modalityIcon(doc.modality);
                      const pct = scorePercent(doc.score);
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
                                disabled={downloadingKey === doc.ObjectKey}
                                onClick={() =>
                                  void handleDownload(doc.ObjectKey)
                                }
                              >
                                {downloadingKey === doc.ObjectKey ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <Download className="size-3.5" />
                                )}
                                {downloadingKey === doc.ObjectKey
                                  ? "Opening…"
                                  : "Download"}
                              </Button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  {searchLoadingMore && (
                    <div className="space-y-3 pt-1">
                      <SearchResultSkeleton />
                      <SearchResultSkeleton />
                    </div>
                  )}
                  {searchHasMore && !searchLoadingMore && (
                    <div className="flex justify-center pt-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={loadMoreSearch}
                        className="gap-1.5 text-muted-foreground hover:text-foreground"
                      >
                        <ChevronDown className="size-3.5" />
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
          if (!open) setDeleteTarget(null);
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
  );
}
