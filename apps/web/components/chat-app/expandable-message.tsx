"use client"

import { useState } from "react"

export function ExpandableMessage({ content }: { content: string }) {
   const [expanded, setExpanded] = useState(false)
   const needsTruncate = content.length > 300
   const display = expanded || !needsTruncate ? content : content.slice(0, 300) + "…"

   return (
      <div>
         <p className="whitespace-pre-wrap text-sm leading-relaxed">{display}</p>
         {needsTruncate && (
            <button
               type="button"
               onClick={() => setExpanded(!expanded)}
               className="mt-2 cursor-pointer rounded-md bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
               {expanded ? "Show less" : "Show more"}
            </button>
         )}
      </div>
   )
}
