"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

export function VersionPager({
   index,
   total,
   onPrev,
   onNext,
   className,
}: {
   index: number
   total: number
   onPrev: () => void
   onNext: () => void
   className?: string
}) {
   if (total <= 1) return null
   return (
      <div className={cn("inline-flex items-center gap-0.5 text-xs text-muted-foreground", className)}>
         <button
            type="button"
            disabled={index <= 0}
            onClick={onPrev}
            className="rounded p-0.5 hover:bg-secondary hover:text-foreground disabled:opacity-30"
            aria-label="Previous version"
         >
            <ChevronLeft className="size-3.5" />
         </button>
         <span className="min-w-[2.5rem] text-center tabular-nums font-medium">
            {index + 1}/{total}
         </span>
         <button
            type="button"
            disabled={index >= total - 1}
            onClick={onNext}
            className="rounded p-0.5 hover:bg-secondary hover:text-foreground disabled:opacity-30"
            aria-label="Next version"
         >
            <ChevronRight className="size-3.5" />
         </button>
      </div>
   )
}
