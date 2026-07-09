import Link from "next/link"
import { Brain } from "lucide-react"

import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"

type SiteHeaderProps = {
  variant?: "marketing" | "app"
}

export function SiteHeader({ variant = "marketing" }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 tracking-tight"
        >
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Brain className="size-4" />
          </span>
          <span className="font-display text-lg tracking-wide">RecallOS</span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          <ThemeToggle />
          {variant === "marketing" ? (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/chat">Chat</Link>
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/signin">Sign in</Link>
              </Button>
              <Button size="sm" asChild>
                <Link href="/signup">Get started</Link>
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/chat">Chat</Link>
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/">Home</Link>
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}
