"use client"

import { useState } from "react"
import {
   BookOpen,
   Clock,
   ExternalLink,
   FileText,
   Film,
   Globe,
   ImageIcon,
   Loader2,
   AudioLines,
   X,
} from "lucide-react"
import type { Message, SourceChunk } from "./types"
import { getDownloadUrl } from "@/lib/api/documents"

function formatTimestamp(sec: number | null | undefined): string | null {
   if (sec == null || !Number.isFinite(sec)) return null
   const s = Math.max(0, Math.floor(sec))
   const m = Math.floor(s / 60)
   const r = s % 60
   return `${m}:${r.toString().padStart(2, "0")}`
}

function modalityIcon(modality?: string | null) {
   switch (modality) {
      case "image":
         return ImageIcon
      case "audio":
         return AudioLines
      case "video":
         return Film
      default:
         return FileText
   }
}

function SourceCard({ chunk }: { chunk: SourceChunk }) {
   const [opening, setOpening] = useState(false)
   const [mediaUrl, setMediaUrl] = useState<string | null>(null)
   const [error, setError] = useState("")

   let href = chunk.url
   let label = chunk.title || chunk.url || chunk.id
   if (!href && chunk.text) {
      const urlMatch = chunk.text.match(/https?:\/\/[^\s]+/)
      if (urlMatch) href = urlMatch[0]
      const firstLine = chunk.text.split("\n")[0]?.trim()
      if (firstLine && !firstLine.startsWith("http") && !chunk.title) label = firstLine
   }
   const isWebSource = Boolean(href)
   const Icon = modalityIcon(chunk.modality)
   const timeLabel = formatTimestamp(chunk.timestampStart)
   const timeEnd = formatTimestamp(chunk.timestampEnd)

   async function openMedia() {
      if (!chunk.objectKey) return
      setOpening(true)
      setError("")
      try {
         const url = await getDownloadUrl(chunk.objectKey)
         // Append media fragment for audio/video seek when possible
         let finalUrl = url
         if (
            (chunk.modality === "audio" || chunk.modality === "video") &&
            chunk.timestampStart != null
         ) {
            // Many browsers ignore #t= on cross-origin presigned URLs; still set for same-origin cases
            finalUrl = `${url}#t=${Math.floor(chunk.timestampStart)}`
         }
         setMediaUrl(finalUrl)
         if (chunk.modality === "pdf" || !chunk.modality) {
            window.open(url, "_blank", "noopener,noreferrer")
         }
      } catch (e) {
         setError(e instanceof Error ? e.message : "Failed to open source")
      } finally {
         setOpening(false)
      }
   }

   return (
      <div
         id={`source-rank-${chunk.rank}`}
         className="scroll-mt-4 space-y-2 rounded-2xl bg-secondary px-4 py-3 text-foreground"
      >
         <div className="flex items-center gap-2">
            <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-background/70 text-[10px] font-semibold">
               {chunk.rank}
            </span>
            {isWebSource && label ? (
               <span
                  className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
                  title={href || label}
               >
                  {label}
               </span>
            ) : (
               <span className="min-w-0 flex-1 truncate text-sm font-medium" title={label}>
                  {chunk.title || label}
               </span>
            )}
            {!isWebSource && (
               <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
                  {(chunk.score * 100).toFixed(1)}%
               </span>
            )}
            {isWebSource && (
               <Globe className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
            )}
         </div>

         <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
            {chunk.modality && (
               <span className="inline-flex items-center gap-1 rounded-full bg-background/60 px-2 py-0.5 font-mono uppercase">
                  <Icon className="size-3" />
                  {chunk.modality}
               </span>
            )}
            {chunk.page != null && (
               <span className="rounded-full bg-background/60 px-2 py-0.5 font-mono">
                  p.{chunk.page}
               </span>
            )}
            {timeLabel && (
               <span className="inline-flex items-center gap-1 rounded-full bg-background/60 px-2 py-0.5 font-mono">
                  <Clock className="size-3" />
                  {timeLabel}
                  {timeEnd ? `–${timeEnd}` : ""}
               </span>
            )}
         </div>

         {isWebSource && href && (
            <a
               href={href}
               target="_blank"
               rel="noopener noreferrer"
               className="block truncate text-[11px] text-primary underline underline-offset-2 decoration-primary/50 hover:decoration-primary"
            >
               {href}
            </a>
         )}

         {chunk.text ? (
            <p className="text-sm leading-relaxed text-muted-foreground line-clamp-6">
               {chunk.text}
            </p>
         ) : null}

         {chunk.caption && (
            <p className="text-[11px] italic text-muted-foreground line-clamp-2">
               {chunk.caption}
            </p>
         )}

         {!isWebSource && chunk.objectKey && (
            <div className="space-y-2 pt-1">
               <button
                  type="button"
                  onClick={() => void openMedia()}
                  disabled={opening}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/50 px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-background"
               >
                  {opening ? (
                     <Loader2 className="size-3 animate-spin" />
                  ) : (
                     <ExternalLink className="size-3" />
                  )}
                  {chunk.modality === "image"
                     ? "Open image"
                     : chunk.modality === "audio"
                       ? "Open audio"
                       : chunk.modality === "video"
                         ? "Open video"
                         : chunk.page != null
                           ? `Open PDF (p.${chunk.page})`
                           : "Open source file"}
               </button>
               {error && <p className="text-[11px] text-destructive">{error}</p>}
               {mediaUrl && chunk.modality === "image" && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                     src={mediaUrl}
                     alt={chunk.title || "Source image"}
                     className="max-h-48 w-full rounded-lg border border-border/60 object-contain bg-background/40"
                  />
               )}
               {mediaUrl && chunk.modality === "audio" && (
                  <audio controls src={mediaUrl} className="w-full" preload="metadata" />
               )}
               {mediaUrl && chunk.modality === "video" && (
                  <video
                     controls
                     src={mediaUrl}
                     className="max-h-48 w-full rounded-lg border border-border/60 bg-black"
                     preload="metadata"
                  />
               )}
            </div>
         )}
      </div>
   )
}

export function SourcePanel({
   message,
   onClose,
}: {
   message: Message | undefined
   onClose: () => void
}) {
   const chunks = message?.sourceChunks
   if (!chunks || chunks.length === 0) return null

   return (
      <>
         <button
            type="button"
            aria-label="Close sources"
            className="fixed inset-0 z-[190] cursor-default"
            onClick={onClose}
         />
         <div className="fixed inset-y-3 right-3 z-[200] flex w-[min(20rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-border/50 bg-background/90 shadow-xl backdrop-blur-md">
            <div className="flex shrink-0 items-center justify-between px-4 py-3">
               <div className="flex items-center gap-2">
                  <BookOpen className="size-3.5 text-muted-foreground" />
                  <span className="text-sm font-medium tracking-tight">Sources</span>
                  <span className="text-[11px] text-muted-foreground">{chunks.length}</span>
               </div>
               <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
               >
                  <X className="size-3.5" />
               </button>
            </div>
            <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 pb-3">
               {chunks.map((chunk) => (
                  <SourceCard key={`${chunk.id}-${chunk.rank}`} chunk={chunk} />
               ))}
            </div>
         </div>
      </>
   )
}
