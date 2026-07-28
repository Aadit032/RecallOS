"use client";

import Link from "next/link";
import { Folder, Pin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";

import { useChatState } from "./use-chat-state";
import { ChatSidebar } from "./chat-sidebar";
import { ChatMessages } from "./chat-messages";
import { Composer } from "./composer";
import { ChatModals } from "./modals";
import { SourcePanel } from "./source-panel";

function ChatLayout() {
  const { state: sidebarState } = useSidebar();
  const chat = useChatState();

  return (
    <>
      <ChatSidebar
        sidebarState={sidebarState}
        sessions={chat.sessions}
        active={chat.active}
        query={chat.query}
        projects={chat.projects}
        unfiledChats={chat.unfiledChats}
        pinnedChats={chat.pinnedChats}
        recentChats={chat.recentChats}
        projectChatsMap={chat.projectChatsMap}
        expandedProjectIds={chat.expandedProjectIds}
        panelProjectIds={chat.panelProjectIds}
        showProjects={chat.showProjects}
        showChats={chat.showChats}
        openPanel={chat.openPanel}
        loading={chat.loading}
        loadingMore={chat.loadingMore}
        createChat={chat.createChat}
        selectChat={chat.selectChat}
        togglePin={chat.togglePin}
        moveToProject={chat.moveToProject}
        setDeleteTarget={chat.setDeleteTarget}
        openEditProject={chat.openEditProject}
        setQuery={chat.setQuery}
        setOpenPanel={chat.setOpenPanel}
        setExpandedProjectIds={chat.setExpandedProjectIds}
        setPanelProjectIds={chat.setPanelProjectIds}
        setShowProjects={chat.setShowProjects}
        setShowChats={chat.setShowChats}
        setShowCreateProjectModal={chat.setShowCreateProjectModal}
        loadMoreRef={chat.loadMoreRef}
      />

      {/* Source chunks side panel */}
      <SourcePanel
        message={chat.active?.messages.find(
          (m) => m.id === chat.openSourceMsgId,
        )}
        onClose={() => chat.setOpenSourceMsgId(null)}
      />

      <SidebarInset className="min-h-0 overflow-hidden bg-transparent">
        <header className="relative z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border/80 bg-background/70 px-3 backdrop-blur-md sm:px-4">
          <div className="min-w-0 flex-1">
            <h1 className="font-display truncate text-base font-medium tracking-tight sm:text-lg">
              {chat.active?.title ?? "Chat"}
            </h1>
          </div>
          {chat.active?.pinned && (
            <Badge variant="secondary" className="hidden gap-1 sm:inline-flex">
              <Pin className="size-3" />
              Pinned
            </Badge>
          )}
          {chat.active?.projectName && (
            <Badge variant="outline" className="hidden gap-1 sm:inline-flex">
              <Folder className="size-3" />
              {chat.active.projectName}
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="hidden sm:inline-flex"
          >
            <Link href="/dashboard">Dashboard</Link>
          </Button>
        </header>

        <div className="relative min-h-0 flex-1">
          <div
            ref={chat.scrollRef}
            className="absolute inset-0 overflow-y-auto"
          >
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-8 pb-28 sm:px-6 sm:pb-32">
              <ChatMessages
                messages={chat.active?.messages ?? []}
                error={chat.error}
                sending={chat.sending}
                loadingMessages={chat.loadingMessages}
                showEmptyState={chat.showEmptyState}
                editingMessageId={chat.editingMessageId}
                copiedMessageId={chat.copiedMessageId}
                sendStatus={chat.sendStatus}
                agentSteps={chat.agentSteps}
                agentStepsDismissed={chat.agentStepsDismissed}
                setTurnVersion={chat.setTurnVersion}
                copyMessageText={chat.copyMessageText}
                startEditMessage={chat.startEditMessage}
                setOpenSourceMsgId={chat.setOpenSourceMsgId}
                setAgentStepsDismissed={chat.setAgentStepsDismissed}
                cancelSending={chat.cancelSending}
                bottomRef={chat.bottomRef}
              />
            </div>
          </div>

          <Composer
            draft={chat.draft}
            attachedFile={chat.attachedFile}
            uploadingFile={chat.uploadingFile}
            listening={chat.listening}
            sending={chat.sending}
            loadingMessages={chat.loadingMessages}
            editingMessageId={chat.editingMessageId}
            setDraft={chat.setDraft}
            setAttachedFile={chat.setAttachedFile}
            setListening={chat.setListening}
            sendMessage={chat.sendMessage}
            cancelEdit={chat.cancelEdit}
            onKeyDown={chat.onKeyDown}
            textareaRef={chat.textareaRef}
            fileRef={chat.fileRef}
          />
        </div>
      </SidebarInset>

      <ChatModals
        showCreateProjectModal={chat.showCreateProjectModal}
        showEditProjectModal={chat.showEditProjectModal}
        deleteTarget={chat.deleteTarget}
        newProjectName={chat.newProjectName}
        creatingProject={chat.creatingProject}
        editingProject={chat.editingProject}
        editProjectName={chat.editProjectName}
        editProjectPrompt={chat.editProjectPrompt}
        savingProject={chat.savingProject}
        deleting={chat.deleting}
        setShowCreateProjectModal={chat.setShowCreateProjectModal}
        setShowEditProjectModal={chat.setShowEditProjectModal}
        setNewProjectName={chat.setNewProjectName}
        setEditingProject={chat.setEditingProject}
        setEditProjectName={chat.setEditProjectName}
        setEditProjectPrompt={chat.setEditProjectPrompt}
        setDeleteTarget={chat.setDeleteTarget}
        createProject={chat.createProject}
        saveProject={chat.saveProject}
        confirmDelete={chat.confirmDelete}
      />
    </>
  );
}

export default function ChatPage() {
  return (
    <SidebarProvider
      defaultOpen
      className="chat-stage h-svh! min-h-0! overflow-hidden"
    >
      <div className="page-art page-art--chat" aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="page-art-image" src="/bg-assets/wings.png" alt="" />
      </div>
      <ChatLayout />
    </SidebarProvider>
  );
}
