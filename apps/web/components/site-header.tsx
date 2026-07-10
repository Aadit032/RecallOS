import Link from "next/link"

import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"

type SiteHeaderProps = {
  variant?: "marketing" | "app"
}

export function SiteHeader({ variant = "marketing" }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-50 border-b border-border/80 bg-background/75 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 tracking-tight">
          <span className="font-display text-lg font-medium tracking-tight">
            RecallOS
          </span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          <ThemeToggle />
          {variant === "marketing" ? (
            <>
              {/* <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
                <Link href="/chat">Chat</Link>
              </Button> */}
              <Button variant="ghost" size="sm" asChild>
                <Link href="/signin">Sign in</Link>
              </Button>
              <Button size="sm" asChild className="font-medium">
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
