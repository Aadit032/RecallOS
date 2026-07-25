"use client"

import { useEffect, useRef } from "react"
import { X } from "lucide-react"

export function FloatingPanel({
   open,
   onClose,
   children,
   title,
   count,
}: {
   open: boolean
   onClose: () => void
   children: React.ReactNode
   title: string
   count?: number
}) {
   const ref = useRef<HTMLDivElement>(null)

   useEffect(() => {
      if (!open) return
      function handleClick(e: MouseEvent) {
         const target = e.target as HTMLElement
         if (ref.current?.contains(target)) return
         if (target.closest?.("[data-panel-trigger]")) return
         onClose()
      }
      function handleKey(e: KeyboardEvent) {
         if (e.key === "Escape") onClose()
      }
      document.addEventListener("mousedown", handleClick)
      document.addEventListener("keydown", handleKey)
      return () => {
         document.removeEventListener("mousedown", handleClick)
         document.removeEventListener("keydown", handleKey)
      }
   }, [open, onClose])

   if (!open) return null

   return (
      <div
         ref={ref}
         className="animate-panel-in fixed top-14 left-[calc(var(--sidebar-width-icon)+0.5rem)] z-[200] flex max-h-[min(22rem,calc(100svh-5rem))] w-56 flex-col overflow-hidden rounded-xl border border-zinc-300 bg-zinc-200 shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
      >
         <div className="flex shrink-0 items-center justify-between border-b border-zinc-300/80 px-2.5 py-2 dark:border-zinc-700/80">
            <div className="flex items-center gap-1.5">
               <span className="text-xs font-medium">{title}</span>
               {typeof count === "number" && (
                  <span className="text-[10px] opacity-60">{count}</span>
               )}
            </div>
            <button
               type="button"
               onClick={onClose}
               className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            >
               <X className="size-3.5" />
            </button>
         </div>
         <div className="min-h-0 flex-1 overflow-y-auto p-1.5">{children}</div>
      </div>
   )
}
