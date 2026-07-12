"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Loader2 } from "lucide-react"

import ChatPage from "@/components/chat-app"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"

export default function Home() {
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    const token = localStorage.getItem("token")
    setAuthed(!!token)
  }, [])

  if (authed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!authed) {
    return (
      <div className="flex min-h-screen flex-col">
        <header className="border-b border-border/80 bg-background/75 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2.5 tracking-tight">
              <span className="font-display text-lg font-medium tracking-tight">
                RecallOS
              </span>
            </Link>
            <nav className="flex items-center gap-1 sm:gap-2">
              <ThemeToggle />
              <Button variant="ghost" size="sm" asChild>
                <Link href="/signin">Sign in</Link>
              </Button>
              <Button size="sm" asChild className="font-medium">
                <Link href="/signup">Get started</Link>
              </Button>
            </nav>
          </div>
        </header>

        <main className="relative flex flex-1 items-center justify-center px-4 py-16">
          <div className="archive-grid pointer-events-none absolute inset-0 opacity-30" />
          <div className="memory-glow relative w-full max-w-md overflow-hidden rounded-xl border border-border/80 bg-card text-center">
            <div className="px-6 py-12 sm:px-8">
              <p className="mb-3 font-mono text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
                Organizational memory OS
              </p>
              <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">
                Your company{" "}
                <span className="font-script text-foreground">remembers</span>
                <span className="text-muted-foreground">.</span>
              </h1>
              <p className="mx-auto mt-4 max-w-sm text-base text-muted-foreground">
                Sign in to start querying your organizational knowledge base.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Button size="lg" className="h-11 px-7 text-base font-medium" asChild>
                  <Link href="/signin">Sign in</Link>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="h-11 border-border/90 bg-card/60 px-7 text-base backdrop-blur-sm"
                  asChild
                >
                  <Link href="/signup">Create account</Link>
                </Button>
              </div>
            </div>
          </div>
        </main>
      </div>
    )
  }

  return <ChatPage />
}
