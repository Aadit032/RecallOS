"use client"

import { Fragment } from "react"
import Link from "next/link"
import {
   Check,
   ChevronDown,
   ChevronRight,
   FileText,
   Folder,
   FolderInput,
   Loader2,
   MoreHorizontal,
   Pin,
   PinOff,
   Plus,
   Search,
   Settings2,
   SquarePen,
   Trash2,
   User,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuLabel,
   DropdownMenuSeparator,
   DropdownMenuSub,
   DropdownMenuSubContent,
   DropdownMenuSubTrigger,
   DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
   Sidebar,
   SidebarContent,
   SidebarFooter,
   SidebarGroup,
   SidebarGroupContent,
   SidebarGroupLabel,
   SidebarHeader,
   SidebarMenu,
   SidebarMenuAction,
   SidebarMenuButton,
   SidebarMenuItem,
   SidebarTrigger,
} from "@/components/ui/sidebar"

import type { ChatSession, Project } from "./types"
import { DRAFT_ID, formatChatTime } from "./helpers"
import { FloatingPanel } from "./floating-panel"

interface ChatSidebarProps {
   sidebarState: "expanded" | "collapsed"
   sessions: ChatSession[]
   active: ChatSession | undefined
   query: string
   projects: Project[]
   unfiledChats: ChatSession[]
   pinnedChats: ChatSession[]
   recentChats: ChatSession[]
   projectChatsMap: Map<string, ChatSession[]>
   expandedProjectIds: Set<string>
   panelProjectIds: Set<string>
   showProjects: boolean
   showChats: boolean
   openPanel: "projects" | "chats" | null
   loading: boolean
   loadingMore: boolean
   // Actions
   createChat: () => void
   selectChat: (id: string) => void
   togglePin: (id: string) => void
   moveToProject: (chatId: string, projectId: string | null) => void
   setDeleteTarget: (target: { type: "chat" | "project"; id: string; name: string } | null) => void
   openEditProject: (project: Project) => void
   // Setters
   setQuery: (q: string) => void
   setOpenPanel: (p: "projects" | "chats" | null) => void
   setExpandedProjectIds: React.Dispatch<React.SetStateAction<Set<string>>>
   setPanelProjectIds: React.Dispatch<React.SetStateAction<Set<string>>>
   setShowProjects: (v: boolean) => void
   setShowChats: (v: boolean) => void
   setShowCreateProjectModal: (v: boolean) => void
   // Refs
   loadMoreRef: React.RefObject<HTMLDivElement | null>
}

export function ChatSidebar({
   sidebarState,
   sessions,
   active,
   query,
   projects,
   unfiledChats,
   pinnedChats,
   recentChats,
   projectChatsMap,
   expandedProjectIds,
   panelProjectIds,
   showProjects,
   showChats,
   openPanel,
   loading,
   loadingMore,
   createChat,
   selectChat,
   togglePin,
   moveToProject,
   setDeleteTarget,
   openEditProject,
   setQuery,
   setOpenPanel,
   setExpandedProjectIds,
   setPanelProjectIds,
   setShowProjects,
   setShowChats,
   setShowCreateProjectModal,
   loadMoreRef,
}: ChatSidebarProps) {
   return (
      <>
         <Sidebar collapsible="icon" className="border-r">
            {/* ── Header ─────────────────────────────────────────── */}
            {sidebarState === "expanded" ? (
               <SidebarHeader className="gap-2 p-2">
                  <div className="mt-3 flex items-center gap-2">
                     <SidebarTrigger />
                     <span className="font-display truncate text-base font-medium tracking-tight">
                        Recall-OS
                     </span>
                  </div>
                  <SidebarMenu>
                     <SidebarMenuItem>
                        <SidebarMenuButton onClick={createChat} tooltip="New chat" className="mt-6">
                           <SquarePen className="size-4" />
                           <span className="truncate">New chat</span>
                        </SidebarMenuButton>
                     </SidebarMenuItem>
                  </SidebarMenu>
                  <div className="relative mb-3">
                     <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                     <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search chats…"
                        className="h-9 w-full rounded-md border border-sidebar-border bg-background pr-3 pl-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                     />
                  </div>
               </SidebarHeader>
            ) : (
               <SidebarHeader className="items-center gap-1 p-2">
                  <SidebarTrigger className="size-8" />
                  <SidebarMenu className="items-center">
                     <SidebarMenuItem>
                        <SidebarMenuButton
                           onClick={() => { createChat(); setOpenPanel(null) }}
                           tooltip="New chat"
                           className="justify-center"
                        >
                           <SquarePen className="size-4" />
                        </SidebarMenuButton>
                     </SidebarMenuItem>
                  </SidebarMenu>
               </SidebarHeader>
            )}

            {/* ── Sidebar content ────────────────────────────────── */}
            <SidebarContent>
               {sidebarState === "collapsed" ? (
                  <SidebarMenu className="items-center gap-1 px-0">
                     <SidebarMenuItem>
                        <SidebarMenuButton
                           data-panel-trigger
                           tooltip="Projects"
                           onClick={() => setOpenPanel(openPanel === "projects" ? null : "projects")}
                           isActive={openPanel === "projects"}
                           className="justify-center"
                        >
                           <Folder className="size-4" />
                        </SidebarMenuButton>
                     </SidebarMenuItem>
                     <SidebarMenuItem>
                        <SidebarMenuButton
                           data-panel-trigger
                           tooltip="Chats"
                           onClick={() => setOpenPanel(openPanel === "chats" ? null : "chats")}
                           isActive={openPanel === "chats"}
                           className="justify-center"
                        >
                           <FileText className="size-4" />
                        </SidebarMenuButton>
                     </SidebarMenuItem>
                  </SidebarMenu>
               ) : (
                  <>
                     {/* Projects */}
                     <SidebarGroup>
                        <SidebarGroupLabel asChild>
                           <button
                              onClick={() => setShowProjects(!showProjects)}
                              className="flex w-full cursor-pointer items-center gap-1.5"
                           >
                              <Folder className="size-4 shrink-0" />
                              <span className="truncate">Projects</span>
                              {showProjects ? <ChevronDown className="size-1" /> : <ChevronRight className="size-1" />}
                              <span className="text-[10px] opacity-60">{projects.length}</span>
                              <span
                                 className="ml-auto flex size-3.5 items-center justify-center rounded opacity-60 hover:opacity-100"
                                 title="New project"
                                 onClick={(e) => { e.stopPropagation(); setShowCreateProjectModal(true) }}
                              >
                                 <Plus className="size-3" />
                              </span>
                           </button>
                        </SidebarGroupLabel>
                        {showProjects && (
                           <SidebarGroupContent className="animate-sidebar-section">
                              {projects.length === 0 ? (
                                 <p className="px-2 py-2 text-xs text-muted-foreground">No projects yet.</p>
                              ) : (
                                 <SidebarMenu>
                                    {projects.map((project) => {
                                       const expanded = expandedProjectIds.has(project.id)
                                       const projectChats = projectChatsMap.get(project.id) ?? []
                                       return (
                                          <Fragment key={project.id}>
                                             <SidebarMenuItem>
                                                <SidebarMenuButton
                                                   className="h-auto items-center gap-2 py-1.5"
                                                   tooltip={project.name}
                                                   onClick={() => setExpandedProjectIds((prev) => {
                                                      const next = new Set(prev)
                                                      if (next.has(project.id)) next.delete(project.id)
                                                      else next.add(project.id)
                                                      return next
                                                   })}
                                                >
                                                   <Folder className="size-3 shrink-0 opacity-70" />
                                                   <span className="min-w-0 flex-1 truncate text-xs font-medium">{project.name}</span>
                                                   {expanded ? <ChevronDown className="size-1 shrink-0 opacity-70" /> : <ChevronRight className="size-1 shrink-0 opacity-70" />}
                                                   {typeof project.chatCount === "number" && <span className="text-[10px] opacity-60">{project.chatCount}</span>}
                                                </SidebarMenuButton>
                                                <SidebarMenuAction showOnHover title="Edit project" onClick={() => openEditProject(project)}>
                                                   <Settings2 className="size-2 mb-1" />
                                                </SidebarMenuAction>
                                             </SidebarMenuItem>
                                             {expanded && projectChats.map((chat) => (
                                                <SidebarMenuItem key={chat.id} className="pl-8">
                                                   <SidebarMenuButton
                                                      isActive={chat.id === active?.id}
                                                      onClick={() => selectChat(chat.id)}
                                                      className="h-auto py-1.5"
                                                      tooltip={chat.title}
                                                   >
                                                      <span className="truncate text-xs">{chat.title}</span>
                                                   </SidebarMenuButton>
                                                   {chat.id !== DRAFT_ID && (
                                                      <DropdownMenu>
                                                         <DropdownMenuTrigger asChild>
                                                            <SidebarMenuAction showOnHover title="More" onClick={(e) => e.stopPropagation()}>
                                                               <MoreHorizontal className="size-3.5" />
                                                            </SidebarMenuAction>
                                                         </DropdownMenuTrigger>
                                                         <DropdownMenuContent side="right" align="start" className="w-48" onClick={(e) => e.stopPropagation()}>
                                                            <DropdownMenuItem onClick={() => void togglePin(chat.id)}>
                                                               {chat.pinned ? <><PinOff className="size-3.5" />Unpin</> : <><Pin className="size-3.5" />Pin</>}
                                                            </DropdownMenuItem>
                                                            <DropdownMenuSub>
                                                               <DropdownMenuSubTrigger><FolderInput className="size-3.5" />Move to project</DropdownMenuSubTrigger>
                                                               <DropdownMenuSubContent className="w-48">
                                                                  <DropdownMenuItem onClick={() => void moveToProject(chat.id, null)}>
                                                                     {!chat.projectId && <Check className="size-3.5" />}
                                                                     <span className={chat.projectId ? "pl-5" : undefined}>No project</span>
                                                                  </DropdownMenuItem>
                                                                  {projects.length > 0 && <DropdownMenuSeparator />}
                                                                  {projects.map((project) => (
                                                                     <DropdownMenuItem key={project.id} onClick={() => void moveToProject(chat.id, project.id)}>
                                                                        {chat.projectId === project.id && <Check className="size-3.5" />}
                                                                        <span className={chat.projectId === project.id ? undefined : "pl-5"}>{project.name}</span>
                                                                     </DropdownMenuItem>
                                                                  ))}
                                                               </DropdownMenuSubContent>
                                                            </DropdownMenuSub>
                                                            <DropdownMenuSeparator />
                                                            <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget({ type: "chat", id: chat.id, name: chat.title })}>
                                                               <Trash2 className="size-3.5" />Delete
                                                            </DropdownMenuItem>
                                                         </DropdownMenuContent>
                                                      </DropdownMenu>
                                                   )}
                                                </SidebarMenuItem>
                                             ))}
                                          </Fragment>
                                       )
                                    })}
                                 </SidebarMenu>
                              )}
                           </SidebarGroupContent>
                        )}
                     </SidebarGroup>

                     {/* Chats */}
                     <SidebarGroup>
                        <SidebarGroupLabel asChild>
                           <button
                              onClick={() => setShowChats(!showChats)}
                              className="flex w-full cursor-pointer items-center gap-1.5"
                           >
                              <FileText className="size-4 shrink-0" />
                              <span className="truncate">Chats</span>
                              {showChats ? <ChevronDown className="size-1" /> : <ChevronRight className="size-1" />}
                              <span className="ml-auto text-[10px] opacity-60">{unfiledChats.length}</span>
                           </button>
                        </SidebarGroupLabel>
                        {showChats && (
                           <SidebarGroupContent className="animate-sidebar-section">
                              <SidebarMenu>
                                 {loading && sessions.length <= 1 && (
                                    <p className="px-2 py-6 text-center text-sm text-muted-foreground">Loading chats…</p>
                                 )}
                                 {unfiledChats.length === 0 && !loading && (
                                    <p className="px-2 py-6 text-center text-sm text-muted-foreground">No chats match your search.</p>
                                 )}
                                 {unfiledChats.map((session) => {
                                    const selected = session.id === active?.id
                                    return (
                                       <SidebarMenuItem key={session.id}>
                                          <SidebarMenuButton
                                             isActive={selected}
                                             onClick={() => selectChat(session.id)}
                                             className="h-auto flex-col items-start gap-0.5 py-2 pr-8"
                                             tooltip={session.title}
                                          >
                                             <span className="flex w-full items-center gap-1.5">
                                                {session.pinned && <Pin className="size-3 shrink-0 opacity-70" />}
                                                <span className="truncate text-xs font-medium">{session.title}</span>
                                             </span>
                                             <span className="text-[10px] opacity-70">
                                                {formatChatTime(session.updatedAt)} · {session.messageCount} messages
                                                {session.projectName ? ` · ${session.projectName}` : ""}
                                             </span>
                                          </SidebarMenuButton>
                                          {session.id !== DRAFT_ID && (
                                             <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                   <SidebarMenuAction showOnHover title="More" onClick={(e) => e.stopPropagation()}>
                                                      <MoreHorizontal className="size-3.5" />
                                                   </SidebarMenuAction>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent side="right" align="start" className="w-48" onClick={(e) => e.stopPropagation()}>
                                                   <DropdownMenuItem onClick={() => void togglePin(session.id)}>
                                                      {session.pinned ? <><PinOff className="size-3.5" />Unpin</> : <><Pin className="size-3.5" />Pin</>}
                                                   </DropdownMenuItem>
                                                   <DropdownMenuSub>
                                                      <DropdownMenuSubTrigger><FolderInput className="size-3.5" />Move to project</DropdownMenuSubTrigger>
                                                      <DropdownMenuSubContent className="w-48">
                                                         <DropdownMenuItem onClick={() => void moveToProject(session.id, null)}>
                                                            {!session.projectId && <Check className="size-3.5" />}
                                                            <span className={session.projectId ? "pl-5" : undefined}>No project</span>
                                                         </DropdownMenuItem>
                                                         {projects.length > 0 && <DropdownMenuSeparator />}
                                                         {projects.map((project) => (
                                                            <DropdownMenuItem key={project.id} onClick={() => void moveToProject(session.id, project.id)}>
                                                               {session.projectId === project.id && <Check className="size-3.5" />}
                                                               <span className={session.projectId === project.id ? undefined : "pl-5"}>{project.name}</span>
                                                            </DropdownMenuItem>
                                                         ))}
                                                         {projects.length === 0 && (
                                                            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Create a project first</DropdownMenuLabel>
                                                         )}
                                                      </DropdownMenuSubContent>
                                                   </DropdownMenuSub>
                                                   <DropdownMenuSeparator />
                                                   <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget({ type: "chat", id: session.id, name: session.title })}>
                                                      <Trash2 className="size-3.5" />Delete
                                                   </DropdownMenuItem>
                                                </DropdownMenuContent>
                                             </DropdownMenu>
                                          )}
                                       </SidebarMenuItem>
                                    )
                                 })}
                              </SidebarMenu>

                              <div ref={loadMoreRef} className="h-1 w-full" />
                              {loadingMore && (
                                 <p className="flex items-center justify-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                                    <Loader2 className="size-3.5 animate-spin" />Loading more…
                                 </p>
                              )}
                           </SidebarGroupContent>
                        )}
                     </SidebarGroup>
                  </>
               )}
            </SidebarContent>

            {/* ── Footer: account ────────────────────────────────── */}
            <SidebarFooter className="p-2">
               <SidebarMenu className={sidebarState === "collapsed" ? "items-center" : undefined}>
                  <SidebarMenuItem>
                     <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                           <SidebarMenuButton tooltip="Account" className="justify-center">
                              <Avatar size="sm">
                                 <AvatarFallback><User className="size-4" /></AvatarFallback>
                              </Avatar>
                              <span className="truncate text-md group-data-[collapsible=icon]:hidden">Account</span>
                           </SidebarMenuButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="top" align="start" className="w-48">
                           <DropdownMenuItem asChild><Link href="/dashboard">Dashboard</Link></DropdownMenuItem>
                           <DropdownMenuSeparator />
                           <DropdownMenuItem variant="destructive" onClick={() => { localStorage.removeItem("token"); window.location.href = "/signin" }}>
                              Sign out
                           </DropdownMenuItem>
                        </DropdownMenuContent>
                     </DropdownMenu>
                  </SidebarMenuItem>
               </SidebarMenu>
            </SidebarFooter>
         </Sidebar>

         {/* Floating pickers — only when sidebar is collapsed */}
         {sidebarState === "collapsed" && (
            <>
               <FloatingPanel
                  open={openPanel === "projects"}
                  onClose={() => setOpenPanel(null)}
                  title="Projects"
                  count={projects.length}
               >
                  <div className="mb-2 flex items-center justify-between px-1">
                     <span className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                        Your projects
                     </span>
                     <button
                        type="button"
                        onClick={() => setShowCreateProjectModal(true)}
                        className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                        title="New project"
                     >
                        <Plus className="size-3.5" />
                     </button>
                  </div>
                  {projects.length === 0 ? (
                     <p className="py-6 text-center text-xs text-muted-foreground">No projects yet.</p>
                  ) : (
                     <div className="space-y-0.5">
                        {projects.map((project) => {
                           const expanded = panelProjectIds.has(project.id)
                           const projectChats = projectChatsMap.get(project.id) ?? []
                           return (
                              <div key={project.id}>
                                 <div className="flex items-center gap-0.5">
                                    <button
                                       type="button"
                                       onClick={() => setPanelProjectIds((prev) => {
                                          const next = new Set(prev)
                                          if (next.has(project.id)) next.delete(project.id)
                                          else next.add(project.id)
                                          return next
                                       })}
                                       className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-zinc-300/70 dark:hover:bg-zinc-700/70"
                                    >
                                       {expanded ? <ChevronDown className="size-3 shrink-0 opacity-70" /> : <ChevronRight className="size-3 shrink-0 opacity-70" />}
                                       <Folder className="size-3 shrink-0 opacity-70" />
                                       <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
                                       {typeof project.chatCount === "number" && <span className="text-[10px] opacity-50">{project.chatCount}</span>}
                                    </button>
                                    <button
                                       type="button"
                                       title="Edit project"
                                       onClick={() => openEditProject(project)}
                                       className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-zinc-300/70 hover:text-foreground dark:hover:bg-zinc-700/70"
                                    >
                                       <Settings2 className="size-3" />
                                    </button>
                                 </div>
                                 {expanded && (
                                    <div className="ml-4 space-y-0.5 border-l border-zinc-400/40 pl-2 dark:border-zinc-600/50">
                                       {projectChats.length === 0 ? (
                                          <p className="px-2 py-1.5 text-[11px] text-muted-foreground">No chats</p>
                                       ) : (
                                          projectChats.map((chat) => (
                                             <button
                                                key={chat.id}
                                                type="button"
                                                onClick={() => selectChat(chat.id)}
                                                className={cn(
                                                   "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-zinc-300/70 dark:hover:bg-zinc-700/70",
                                                   chat.id === active?.id && "bg-zinc-300/90 font-medium dark:bg-zinc-700/90"
                                                )}
                                             >
                                                {chat.pinned && <Pin className="size-3 shrink-0 opacity-70" />}
                                                <span className="truncate">{chat.title}</span>
                                             </button>
                                          ))
                                       )}
                                    </div>
                                 )}
                              </div>
                           )
                        })}
                     </div>
                  )}
               </FloatingPanel>

               <FloatingPanel
                  open={openPanel === "chats"}
                  onClose={() => setOpenPanel(null)}
                  title="Chats"
                  count={unfiledChats.filter((s) => s.id !== DRAFT_ID).length}
               >
                  <button
                     type="button"
                     onClick={() => { createChat(); setOpenPanel(null) }}
                     className="mb-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors hover:bg-zinc-300/70 dark:hover:bg-zinc-700/70"
                  >
                     <SquarePen className="size-3 shrink-0" />
                     New chat
                  </button>

                  {pinnedChats.length > 0 && (
                     <div className="mb-2">
                        <div className="mb-1 flex items-center gap-1.5 px-2 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                           <Pin className="size-3 opacity-60" />
                           Pinned
                        </div>
                        <div className="space-y-0.5">
                           {pinnedChats.map((chat) => (
                              <button
                                 key={chat.id}
                                 type="button"
                                 onClick={() => selectChat(chat.id)}
                                 className={cn(
                                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-zinc-300/70 dark:hover:bg-zinc-700/70",
                                    chat.id === active?.id && "bg-zinc-300/90 font-medium dark:bg-zinc-700/90"
                                 )}
                              >
                                 <Pin className="size-3 shrink-0 opacity-70" />
                                 <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                                 <span className="shrink-0 text-[10px] opacity-50">{formatChatTime(chat.updatedAt)}</span>
                              </button>
                           ))}
                        </div>
                     </div>
                  )}

                  <div>
                     <div className="mb-1 flex items-center gap-1.5 px-2 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                        <FileText className="size-3 opacity-60" />
                        Recent
                     </div>
                     {loading && sessions.length <= 1 ? (
                        <p className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                           <Loader2 className="size-3.5 animate-spin" />Loading…
                        </p>
                     ) : recentChats.length === 0 && pinnedChats.length === 0 ? (
                        <p className="py-6 text-center text-xs text-muted-foreground">No chats yet.</p>
                     ) : recentChats.length === 0 ? (
                        <p className="px-2 py-2 text-xs text-muted-foreground">No recent chats.</p>
                     ) : (
                        <div className="space-y-0.5">
                           {recentChats.map((chat) => (
                              <button
                                 key={chat.id}
                                 type="button"
                                 onClick={() => selectChat(chat.id)}
                                 className={cn(
                                    "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-zinc-300/70 dark:hover:bg-zinc-700/70",
                                    chat.id === active?.id && "bg-zinc-300/90 dark:bg-zinc-700/90"
                                 )}
                              >
                                 <span className={cn("truncate", chat.id === active?.id && "font-medium")}>{chat.title}</span>
                                 <span className="text-[10px] opacity-60">
                                    {formatChatTime(chat.updatedAt)}
                                    {chat.projectName ? ` · ${chat.projectName}` : ""}
                                 </span>
                              </button>
                           ))}
                        </div>
                     )}
                  </div>
               </FloatingPanel>
            </>
         )}
      </>
   )
}
