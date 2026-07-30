"use client"

import { useState } from "react"
import { ChevronDown, Globe, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AgentStep } from "./types"

export function AgentStepsList({
   steps,
   live,
}: {
   steps: AgentStep[]
   live?: boolean
}) {
   return (
      <ol className="space-y-2.5">
         {steps.map((step, idx) => {
            const isLatest = live && idx === steps.length - 1
            return (
               <li
                  key={step.id}
                  className={cn(
                     "relative border-l-2 pl-3",
                     isLatest ? "border-primary" : "border-border"
                  )}
               >
                  <div className="flex flex-wrap items-center gap-2">
                     <span className="text-xs font-medium text-foreground">{step.title}</span>
                     {typeof step.iteration === "number" && step.iteration > 0 && (
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                           pass {step.iteration}
                        </span>
                     )}
                     {step.step === "search" && typeof step.resultCount === "number" && (
                        <span className="text-[10px] text-muted-foreground">{step.resultCount} hits</span>
                     )}
                     {isLatest && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
                  </div>
                  {step.detail && (
                     <p className="mt-0.5 text-xs text-muted-foreground">{step.detail}</p>
                  )}
                  {step.query && step.step === "search" && (
                     <p className="mt-0.5 font-mono text-[11px] text-foreground/80">q: {step.query}</p>
                  )}
                  {step.reasoning && (
                     <p className="mt-1 rounded-md bg-background/60 px-2 py-1.5 text-xs leading-relaxed text-foreground/90">
                        <span className="font-medium text-muted-foreground">Reasoning · </span>
                        {step.reasoning}
                     </p>
                  )}
                  {step.nextQuery && (
                     <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Next search: <span className="text-foreground">{step.nextQuery}</span>
                     </p>
                  )}
               </li>
            )
         })}
      </ol>
   )
}

export function AgentStepsDropdown({ steps, defaultOpen = false }: { steps: AgentStep[]; defaultOpen?: boolean }) {
   const [open, setOpen] = useState(defaultOpen)
   if (!steps.length) return null
   return (
      <div className="rounded-lg border border-border/60 bg-muted/20">
         <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
         >
            <Globe className="size-3.5 shrink-0 text-primary" />
            <span className="font-medium">Agent steps</span>
            <span className="text-[10px] opacity-70">{steps.length}</span>
            <ChevronDown className={cn("ml-auto size-3.5 transition-transform", open && "rotate-180")} />
         </button>
         {open && (
            <div className="border-t border-border/50 px-3 py-2.5">
               <AgentStepsList steps={steps} />
            </div>
         )}
      </div>
   )
}
