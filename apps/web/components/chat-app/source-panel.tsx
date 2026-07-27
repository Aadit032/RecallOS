"use client"

import { BookOpen, Globe, X } from "lucide-react"
import type { Message } from "./types"

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
            {chunks.map((chunk) => {
               let href = chunk.url
               let label = chunk.title || chunk.url || chunk.id
               if (!href && chunk.text) {
                  const urlMatch = chunk.text.match(/https?:\/\/[^\s]+/)
                  if (urlMatch) href = urlMatch[0]
                  const firstLine = chunk.text.split("\n")[0]?.trim()
                  if (firstLine && !firstLine.startsWith("http")) label = firstLine
               }
               const isWebSource = Boolean(href)
               return (
                  <div
                     key={`${chunk.id}-${chunk.rank}`}
                     id={`source-rank-${chunk.rank}`}
                     className="scroll-mt-4 space-y-2 rounded-2xl bg-secondary px-4 py-3 text-foreground"
                  >
                     <div className="flex items-center gap-2">
                        <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-background/70 text-[10px] font-semibold">
                           {chunk.rank}
                        </span>
                        {isWebSource && label ? (
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={href || label}>
                               {label}
                            </span>
                         ) : (
                            <span className="truncate text-[10px] text-muted-foreground" title={chunk.id}>
                               {chunk.id.slice(0, 12)}…
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
                  </div>
               )
            })}
         </div>
         </div>
      </>
   )
}
