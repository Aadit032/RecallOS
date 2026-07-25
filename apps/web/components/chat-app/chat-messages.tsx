"use client"

import { Check, Copy, Globe, Loader2, Pencil, BookOpen } from "lucide-react"

import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

import type { Message, AgentStep } from "./types"
import { isWebSearchDraft } from "./helpers"
import { ExpandableMessage } from "./expandable-message"
import { VersionPager } from "./version-pager"
import { MarkdownContent } from "./markdown-content"
import { AgentStepsList, AgentStepsDropdown } from "./agent-steps"

interface ChatMessagesProps {
   messages: Message[]
   error: string
   sending: boolean
   loadingMessages: boolean
   showEmptyState: boolean
   editingMessageId: string | null
   copiedMessageId: string | null
   sendStatus: string
   agentSteps: AgentStep[]
   agentStepsDismissed: boolean
   // Actions
   setTurnVersion: (userMessageId: string, nextIndex: number) => void
   copyMessageText: (id: string, text: string) => void
   startEditMessage: (msg: Message) => void
   setOpenSourceMsgId: (id: string | null) => void
   setAgentStepsDismissed: (v: boolean) => void
   cancelSending: () => void
   // Refs
   bottomRef: React.RefObject<HTMLDivElement | null>
}

export function ChatMessages({
   messages,
   error,
   sending,
   loadingMessages,
   showEmptyState,
   editingMessageId,
   copiedMessageId,
   sendStatus,
   agentSteps,
   agentStepsDismissed,
   setTurnVersion,
   copyMessageText,
   startEditMessage,
   setOpenSourceMsgId,
   setAgentStepsDismissed,
   cancelSending,
   bottomRef,
}: ChatMessagesProps) {
   return (
      <>
         {error && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
         )}

         {loadingMessages && (
            <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
               <Loader2 className="size-4 animate-spin" />Loading conversation…
            </div>
         )}

         {showEmptyState && (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
               <p className="font-mono text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">Recall-OS</p>
               <span className="font-display text-3xl font-medium tracking-tight sm:text-4xl">
                  Ask your <span className="font-script text-foreground">memory</span>
               </span>
               <p className="max-w-md text-muted-foreground">
                  Query documents, notes, and organizational knowledge.
               </p>
            </div>
         )}

         {!loadingMessages && messages.map((message, msgIndex) => {
            if (message.role === "user") {
               const displayRaw = message.content
               const userUsedWeb = isWebSearchDraft(displayRaw)
               const displayContent = userUsedWeb
                  ? displayRaw.replace(/^\/web\s*/i, "").trim() || displayRaw
                  : displayRaw
               const versionTotal = message.versions?.length ?? 0
               const versionIndex = message.versionIndex ?? 0
               const isEditingThis = editingMessageId === message.id

               return (
                  <div key={message.id} className="group/user flex w-full flex-col items-end gap-1.5">
                     {userUsedWeb && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-foreground">
                           <Globe className="size-3 text-primary" />
                           Web search
                        </span>
                     )}
                     <div
                        className={cn(
                           "max-w-[85%] rounded-2xl bg-secondary px-4 py-3 text-foreground sm:max-w-[75%]",
                           isEditingThis && "ring-2 ring-primary/40"
                        )}
                     >
                        <ExpandableMessage content={displayContent} />
                     </div>
                     <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover/user:opacity-100 sm:focus-within:opacity-100">
                        {versionTotal > 1 && (
                           <VersionPager
                              index={versionIndex}
                              total={versionTotal}
                              onPrev={() => setTurnVersion(message.id, versionIndex - 1)}
                              onNext={() => setTurnVersion(message.id, versionIndex + 1)}
                              className="mr-1"
                           />
                        )}
                        <Tooltip>
                           <TooltipTrigger asChild>
                              <button
                                 type="button"
                                 disabled={sending}
                                 onClick={() => void copyMessageText(message.id, message.content)}
                                 className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
                                 aria-label="Copy message"
                              >
                                 {copiedMessageId === message.id ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
                              </button>
                           </TooltipTrigger>
                           <TooltipContent>Copy</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                           <TooltipTrigger asChild>
                              <button
                                 type="button"
                                 disabled={sending}
                                 onClick={() => startEditMessage(message)}
                                 className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
                                 aria-label="Edit message"
                              >
                                 <Pencil className="size-3.5" />
                              </button>
                           </TooltipTrigger>
                           <TooltipContent>Edit & resend</TooltipContent>
                        </Tooltip>
                     </div>
                  </div>
               )
            }

            const isStreamingBubble = sending && message.id.startsWith("temp-assistant-") && message.content.length === 0
            if (isStreamingBubble) return null

            const isLiveStream = sending && message.id.startsWith("temp-assistant-") && message.content.length > 0

            const prevUser =
               msgIndex > 0 && messages[msgIndex - 1]?.role === "user"
                  ? messages[msgIndex - 1]
                  : undefined
            const versionTotal = prevUser?.versions?.length ?? 0
            const versionIndex = prevUser?.versionIndex ?? 0
            const storedSteps = message.agentSteps ?? []

            return (
               <div key={message.id} className="group/assistant w-full space-y-2 text-foreground">
                  <div className="flex items-center gap-2">
                     <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                        RecallOS
                     </p>
                     {versionTotal > 1 && prevUser && (
                        <VersionPager
                           index={versionIndex}
                           total={versionTotal}
                           onPrev={() => setTurnVersion(prevUser.id, versionIndex - 1)}
                           onNext={() => setTurnVersion(prevUser.id, versionIndex + 1)}
                        />
                     )}
                     {!sending && message.content && (
                        <Tooltip>
                           <TooltipTrigger asChild>
                              <button
                                 type="button"
                                 onClick={() => void copyMessageText(message.id, message.content)}
                                 className="ml-auto rounded-md p-1 text-muted-foreground opacity-100 hover:bg-secondary hover:text-foreground sm:opacity-0 sm:transition-opacity sm:group-hover/assistant:opacity-100"
                                 aria-label="Copy answer"
                              >
                                 {copiedMessageId === message.id ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
                              </button>
                           </TooltipTrigger>
                           <TooltipContent>Copy answer</TooltipContent>
                        </Tooltip>
                     )}
                  </div>
                  {!sending && storedSteps.length > 0 && (
                     <AgentStepsDropdown steps={storedSteps} />
                  )}
                  <div className="prose dark:prose-invert max-w-none">
                     <MarkdownContent content={message.content} />
                     {isLiveStream && (
                        <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-foreground/70 align-text-bottom" aria-hidden />
                     )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                     {!sending && message.sourceChunks && message.sourceChunks.length > 0 && (
                        <button
                           type="button"
                           onClick={() => setOpenSourceMsgId(message.id)}
                           className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                           <BookOpen className="size-3.5" />
                           <span>{message.sourceChunks.length} source{message.sourceChunks.length !== 1 ? "s" : ""}</span>
                        </button>
                     )}
                  </div>
               </div>
            )
         })}

         {sending && (
            <div className="space-y-3">
               <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  {(sendStatus.toLowerCase().includes("web") || agentSteps.length > 0) && (
                     <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 font-medium text-foreground">
                        <Globe className="size-3.5 text-primary" />
                        Web search
                     </span>
                  )}
                  <Loader2 className="size-4 animate-spin" />
                  <span>
                     {sendStatus || "Searching memory and generating a reply…"}
                  </span>
                  <button
                     type="button"
                     onClick={cancelSending}
                     className="text-xs font-medium text-destructive hover:underline"
                     title="Cancel request (Ctrl+C)"
                  >
                     Cancel <span className="font-mono text-[10px] opacity-80">Ctrl+C</span>
                  </button>
               </div>

               {agentSteps.length > 0 && !agentStepsDismissed && (
                  <div className="rounded-xl border border-border/70 bg-muted/30 px-3 py-3">
                     <div className="mb-2 flex items-center gap-2">
                        <Globe className="size-3.5 text-primary" />
                        <p className="font-mono text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                           Agent steps
                        </p>
                        <button
                           type="button"
                           className="ml-auto text-[11px] text-muted-foreground hover:text-foreground"
                           onClick={() => setAgentStepsDismissed(true)}
                        >
                           Dismiss
                        </button>
                     </div>
                     <AgentStepsList steps={agentSteps} live />
                  </div>
               )}

               {agentSteps.length > 0 && agentStepsDismissed && (
                  <AgentStepsDropdown steps={agentSteps} />
               )}
            </div>
         )}
         <div ref={bottomRef} className="h-px w-full shrink-0" />
      </>
   )
}
