"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"

import ChatPage from "@/components/chat-app"
import { getSession } from "@/lib/api/auth"

export default function ChatRoute() {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    getSession()
      .then((session) => {
        if (!session?.user) {
          router.replace("/signin")
          return
        }
        setReady(true)
      })
      .catch(() => router.replace("/signin"))
  }, [router])

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return <ChatPage />
}
