"use client"

import { FileText, Globe, Loader2, Mic, MicOff, Pencil, Plus, Send, Waypoints, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

import { isAgentDraft, isWebSearchDraft } from "./helpers"

interface ComposerProps {
   draft: string
   attachedFile: File | null
   uploadingFile: boolean
   listening: boolean
   sending: boolean
   loadingMessages: boolean
   editingMessageId: string | null
   // Setters
   setDraft: (v: string | ((prev: string) => string)) => void
   setAttachedFile: (f: File | null) => void
   setListening: (v: boolean | ((prev: boolean) => boolean)) => void
   // Actions
   sendMessage: () => void
   cancelEdit: () => void
   onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
   // Refs
   textareaRef: React.RefObject<HTMLTextAreaElement | null>
   fileRef: React.RefObject<HTMLInputElement | null>
}

export function Composer({
   draft,
   attachedFile,
   uploadingFile,
   listening,
   sending,
   loadingMessages,
   editingMessageId,
   setDraft,
   setAttachedFile,
   setListening,
   sendMessage,
   cancelEdit,
   onKeyDown,
   textareaRef,
   fileRef,
}: ComposerProps) {
   return (
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-background via-background/95 to-transparent pt-5 pb-3">
         <div className="pointer-events-auto mx-auto w-full max-w-3xl px-4 sm:px-6">
            {attachedFile && (
               <div className="mb-2 flex items-center gap-2 rounded-md bg-secondary/50 px-3 py-1.5 text-sm text-muted-foreground">
                  <FileText className="size-3.5 shrink-0" />
                  <span className="truncate">{attachedFile.name}</span>
                  {uploadingFile && <Loader2 className="size-3 animate-spin" />}
                  <button type="button" className="ml-auto shrink-0 font-medium text-foreground hover:underline" onClick={() => setAttachedFile(null)}>
                     Remove
                  </button>
               </div>
            )}

            {listening && (
               <p className="mb-2 text-center text-xs font-medium text-muted-foreground">Listening… (UI only)</p>
            )}

            {editingMessageId && !sending && (
               <div className="mb-2 flex items-center gap-2 rounded-full border border-primary/30 bg-background/50 px-3 py-1.5 text-sm shadow-sm backdrop-blur-lg">
                  <Pencil className="size-3.5 text-primary" />
                  <span className="font-medium text-foreground">Editing message</span>
                  <span className="hidden text-muted-foreground sm:inline">· resend creates answer 2/2</span>
                  <button
                     type="button"
                     className="ml-auto rounded-full p-0.5 text-muted-foreground hover:bg-background/80 hover:text-foreground"
                     onClick={cancelEdit}
                     aria-label="Cancel edit"
                  >
                     <X className="size-3.5" />
                  </button>
               </div>
            )}

            {isWebSearchDraft(draft) && !sending && (
               <div className="mb-2 flex items-center gap-2 animate-in fade-in slide-in-from-bottom-1 duration-150">
                  <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-background/50 px-3 py-1.5 text-sm shadow-sm backdrop-blur-lg">
                     <Globe className="size-3.5 shrink-0 text-primary" />
                     <span className="font-medium text-foreground">Web search</span>
                     <span className="hidden text-muted-foreground sm:inline">· agent will search the live web</span>
                     <button
                        type="button"
                        className="ml-0.5 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
                        aria-label="Remove web search"
                        title="Remove /web"
                        onClick={() => setDraft((d) => d.replace(/^\/web\s*/i, ""))}
                     >
                        <X className="size-3.5" />
                     </button>
                  </div>
               </div>
            )}

            {isAgentDraft(draft) && !sending && (
               <div className="mb-2 flex items-center gap-2 animate-in fade-in slide-in-from-bottom-1 duration-150">
                  <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-background/50 px-3 py-1.5 text-sm shadow-sm backdrop-blur-lg">
                     <Waypoints className="size-3.5 shrink-0 text-emerald-500" />
                     <span className="font-medium text-foreground">Multi-hop agent</span>
                     <span className="hidden text-muted-foreground sm:inline">· plan → retrieve → reason over your library</span>
                     <button
                        type="button"
                        className="ml-0.5 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
                        aria-label="Remove multi-hop agent"
                        title="Remove /agent"
                        onClick={() => setDraft((d) => d.replace(/^\/agent\s*/i, ""))}
                     >
                        <X className="size-3.5" />
                     </button>
                  </div>
               </div>
            )}

            <div className={cn(
               "memory-glow flex items-center gap-1 rounded-full border bg-background/90 p-1.5 backdrop-blur-sm focus-within:ring-[3px]",
               isWebSearchDraft(draft)
                  ? "border-primary/40 focus-within:border-primary focus-within:ring-primary/25"
                  : isAgentDraft(draft)
                    ? "border-emerald-500/40 focus-within:border-emerald-500 focus-within:ring-emerald-500/25"
                    : "border-border/80 focus-within:border-ring focus-within:ring-ring/30"
            )}>
               <input ref={fileRef} type="file" className="hidden" accept=".pdf,application/pdf"
                  onChange={(e) => { const f = e.target.files?.[0]; setAttachedFile(f ?? null); e.target.value = "" }}
               />
               <div className="flex shrink-0 items-center gap-0.5 pl-0.5">
                  <Tooltip>
                     <TooltipTrigger asChild>
                        <Button type="button" variant="ghost" size="icon-sm" className="rounded-full" onClick={() => fileRef.current?.click()} aria-label="Upload file">
                           <Plus className="size-4" />
                        </Button>
                     </TooltipTrigger>
                     <TooltipContent>Upload a PDF</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                     <TooltipTrigger asChild>
                        <Button
                           type="button"
                           variant={isWebSearchDraft(draft) ? "secondary" : "ghost"}
                           size="icon-sm"
                           className="rounded-full"
                           onClick={() => {
                              if (isWebSearchDraft(draft)) {
                                 setDraft((d) => d.replace(/^\/web\s*/i, ""))
                              } else {
                                 setDraft((d) => {
                                    const t = d.replace(/^\/agent\s*/i, "").trimStart()
                                    return t ? `/web ${t}` : "/web "
                                 })
                              }
                           }}
                           aria-label={isWebSearchDraft(draft) ? "Disable web search" : "Enable web search"}
                        >
                           <Globe className={cn("size-4", isWebSearchDraft(draft) && "text-primary")} />
                        </Button>
                     </TooltipTrigger>
                     <TooltipContent>
                        {isWebSearchDraft(draft) ? "Disable web search" : "Web search (/web)"}
                     </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                     <TooltipTrigger asChild>
                        <Button
                           type="button"
                           variant={isAgentDraft(draft) ? "secondary" : "ghost"}
                           size="icon-sm"
                           className="rounded-full"
                           onClick={() => {
                              if (isAgentDraft(draft)) {
                                 setDraft((d) => d.replace(/^\/agent\s*/i, ""))
                              } else {
                                 setDraft((d) => {
                                    const t = d.replace(/^\/web\s*/i, "").trimStart()
                                    return t ? `/agent ${t}` : "/agent "
                                 })
                              }
                           }}
                           aria-label={isAgentDraft(draft) ? "Disable multi-hop agent" : "Enable multi-hop agent"}
                        >
                           <Waypoints className={cn("size-4", isAgentDraft(draft) && "text-emerald-500")} />
                        </Button>
                     </TooltipTrigger>
                     <TooltipContent>
                        {isAgentDraft(draft) ? "Disable multi-hop agent" : "Multi-hop RAG (/agent)"}
                     </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                     <TooltipTrigger asChild>
                        <Button type="button" variant={listening ? "secondary" : "ghost"} size="icon-sm" className="rounded-full" onClick={() => setListening((v) => !v)} aria-label={listening ? "Stop microphone" : "Use microphone"}>
                           {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                        </Button>
                     </TooltipTrigger>
                     <TooltipContent>{listening ? "Stop listening" : "Voice input"}</TooltipContent>
                  </Tooltip>
               </div>

               <Textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={
                     editingMessageId
                        ? "Edit your message and resend…"
                        : isWebSearchDraft(draft)
                           ? "Search the web… e.g. latest OpenAI announcements"
                           : isAgentDraft(draft)
                             ? "Multi-hop over your library… e.g. compare Q3 goals across PDFs"
                             : "Type /web or /agent for tools…"
                  }
                  rows={1}
                  disabled={sending || loadingMessages}
                  className="max-h-32 min-h-9 flex-1 resize-none border-0 px-2 py-2 text-sm "
               />

               <Button type="button" size="icon-sm" className="mr-0.5 shrink-0 rounded-full"
                  disabled={(!draft.trim() && !attachedFile) || sending || loadingMessages}
                  onClick={() => void sendMessage()} aria-label="Send message">
                  {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
               </Button>
            </div>

            <p className="mt-1.5 text-center text-xs text-muted-foreground">
               Recall-OS can make mistakes. Check important info.
            </p>
         </div>
      </div>
   )
}
