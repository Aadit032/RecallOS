"use client"

import { Loader2, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
   Dialog,
   DialogContent,
   DialogDescription,
   DialogFooter,
   DialogHeader,
   DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

import type { Project } from "./types"

interface ChatModalsProps {
   showCreateProjectModal: boolean
   showEditProjectModal: boolean
   deleteTarget: { type: "chat" | "project"; id: string; name: string } | null
   newProjectName: string
   creatingProject: boolean
   editingProject: Project | null
   editProjectName: string
   editProjectPrompt: string
   savingProject: boolean
   deleting: boolean
   // Setters
   setShowCreateProjectModal: (v: boolean) => void
   setShowEditProjectModal: (v: boolean) => void
   setNewProjectName: (v: string) => void
   setEditingProject: (v: Project | null) => void
   setEditProjectName: (v: string) => void
   setEditProjectPrompt: (v: string) => void
   setDeleteTarget: (v: { type: "chat" | "project"; id: string; name: string } | null) => void
   // Actions
   createProject: () => void
   saveProject: () => void
   confirmDelete: () => void
}

export function ChatModals({
   showCreateProjectModal,
   showEditProjectModal,
   deleteTarget,
   newProjectName,
   creatingProject,
   editingProject,
   editProjectName,
   editProjectPrompt,
   savingProject,
   deleting,
   setShowCreateProjectModal,
   setShowEditProjectModal,
   setNewProjectName,
   setEditingProject,
   setEditProjectName,
   setEditProjectPrompt,
   setDeleteTarget,
   createProject,
   saveProject,
   confirmDelete,
}: ChatModalsProps) {
   return (
      <>
         <Dialog open={showCreateProjectModal} onOpenChange={setShowCreateProjectModal}>
            <DialogContent>
               <DialogHeader>
                  <DialogTitle>New project</DialogTitle>
                  <DialogDescription>Create a project to organize chats and set a shared system prompt.</DialogDescription>
               </DialogHeader>
               <Input value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void createProject() } }}
                  placeholder="Project name" autoFocus />
               <DialogFooter>
                  <Button variant="outline" onClick={() => { setShowCreateProjectModal(false); setNewProjectName("") }}>Cancel</Button>
                  <Button disabled={!newProjectName.trim() || creatingProject} onClick={() => void createProject()}>
                     {creatingProject ? <Loader2 className="size-4 animate-spin" /> : "Create"}
                  </Button>
               </DialogFooter>
            </DialogContent>
         </Dialog>

         <Dialog open={showEditProjectModal} onOpenChange={(open) => { if (!open) { setShowEditProjectModal(false); setEditingProject(null) } }}>
            <DialogContent>
               <DialogHeader>
                  <DialogTitle>Edit project</DialogTitle>
                  <DialogDescription>Rename the project or change its system prompt.</DialogDescription>
               </DialogHeader>
               <div className="space-y-4">
                  <div className="space-y-2">
                     <label className="text-sm font-medium">Name</label>
                     <Input value={editProjectName} onChange={(e) => setEditProjectName(e.target.value)} placeholder="Project name" />
                  </div>
                  <div className="space-y-2">
                     <label className="text-sm font-medium">System prompt</label>
                     <Textarea value={editProjectPrompt} onChange={(e) => setEditProjectPrompt(e.target.value)} rows={4}
                        placeholder="Extra system prompt for chats in this project…" className="resize-y" />
                  </div>
               </div>
               <DialogFooter>
                  <Button variant="ghost" className="text-destructive hover:text-destructive sm:mr-auto"
                     onClick={() => { if (editingProject) { setDeleteTarget({ type: "project", id: editingProject.id, name: editingProject.name }); setShowEditProjectModal(false) } }}>
                     <Trash2 className="size-4" />Delete project
                  </Button>
                  <Button variant="outline" onClick={() => { setShowEditProjectModal(false); setEditingProject(null) }}>Cancel</Button>
                  <Button disabled={savingProject || !editProjectName.trim()} onClick={() => void saveProject()}>
                     {savingProject ? <Loader2 className="size-4 animate-spin" /> : "Save"}
                  </Button>
               </DialogFooter>
            </DialogContent>
         </Dialog>

         <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
            <DialogContent>
               <DialogHeader>
                  <DialogTitle>Delete {deleteTarget?.type === "chat" ? "chat" : "project"}?</DialogTitle>
                  <DialogDescription>
                     {deleteTarget?.type === "chat"
                        ? `Delete "${deleteTarget?.name}"? This cannot be undone.`
                        : `Delete "${deleteTarget?.name}"? Chats will be unfiled, not deleted.`}
                  </DialogDescription>
               </DialogHeader>
               <DialogFooter>
                  <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
                  <Button variant="destructive" disabled={deleting} onClick={() => void confirmDelete()}>
                     {deleting ? <Loader2 className="size-4 animate-spin" /> : "Delete"}
                  </Button>
               </DialogFooter>
            </DialogContent>
         </Dialog>
      </>
   )
}
