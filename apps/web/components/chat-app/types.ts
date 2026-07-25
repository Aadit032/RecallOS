export type Role = "user" | "assistant"

export type SourceChunk = {
   rank: number
   id: string
   score: number
   text: string
   /** Present for /web agent sources — open in a new tab */
   url?: string
   title?: string
}

export type AgentStep = {
   id: string
   step: string
   title: string
   detail?: string
   query?: string
   resultCount?: number
   iteration?: number
   enough?: boolean
   reasoning?: string
   nextQuery?: string
}

/** One user edit + matching assistant reply (for 1/2, 2/2 switching). */
export type TurnVersion = {
   userContent: string
   assistantId: string
   assistantContent: string
   sourceChunks?: SourceChunk[]
   agentSteps?: AgentStep[]
   createdAt: string
}

export type Message = {
   id: string
   role: Role
   content: string
   sourceChunks?: SourceChunk[]
   createdAt: string
   /** Present on user messages after edit/resend — shared with following assistant */
   versions?: TurnVersion[]
   versionIndex?: number
   /** Web agent trail (on assistant messages) */
   agentSteps?: AgentStep[]
}

export type Project = {
   id: string
   name: string
   systemPrompt: string | null
   chatCount?: number
}

export type ChatSession = {
   id: string
   title: string
   pinned: boolean
   projectId: string | null
   projectName: string | null
   updatedAt: string
   messageCount: number
   messages: Message[]
   messagesLoaded: boolean
}

export type ChatListItem = {
   id: string
   title: string
   pinned: boolean
   projectId?: string | null
   projectName?: string | null
   updatedAt: string
   messageCount: number
}

export type StreamEvent =
   | {
        type: "meta"
        chatId: string
        title: string
        isNewSession: boolean
        mode?: "web" | "memory"
        userMessage: { id: string; role: string; content: string; createdAt: string }
        sources: SourceChunk[]
     }
   | { type: "delta"; content: string }
   | { type: "status"; message: string; mode?: "web" | "memory" }
   | {
        type: "agent_step"
        step: string
        title: string
        detail?: string
        query?: string
        resultCount?: number
        iteration?: number
        enough?: boolean
        reasoning?: string
        nextQuery?: string
     }
   | {
        type: "done"
        chatId: string
        title: string
        isNewSession: boolean
        mode?: "web" | "memory"
        userMessage: { id: string; role: string; content: string; createdAt: string }
        assistantMessage: { id: string; role: string; content: string; createdAt: string }
        sources: SourceChunk[]
     }
   | { type: "error"; message: string }
