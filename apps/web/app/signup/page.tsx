"use client"

import { useRef, useState } from "react"
import axios from "axios"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Brain, Loader2 } from "lucide-react"

import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function Signup() {
  const router = useRouter()
  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault()
    const username = usernameRef.current?.value
    const password = passwordRef.current?.value

    setLoading(true)
    setError("")

    try {
      await axios.post("http://localhost:3000/api/v1/auth/signup", {
        username,
        password,
      })
      router.push("/signin")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign up failed. Try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-background/80 backdrop-blur-sm">
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
          <ThemeToggle />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <Card className="w-full max-w-md gap-0 py-0 shadow-sm">
          <CardHeader className="space-y-2 border-b px-6 py-8">
            <CardTitle className="font-display text-3xl font-normal tracking-tight sm:text-4xl">
              Create your account
            </CardTitle>
            <CardDescription className="text-base">
              Start building{" "}
              <span className="font-script text-xl">searchable memory</span> for
              your organization.
            </CardDescription>
          </CardHeader>

          <form onSubmit={handleAuth}>
            <CardContent className="space-y-5 px-6 py-8">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-sm font-semibold">
                  Username
                </Label>
                <Input
                  id="username"
                  ref={usernameRef}
                  placeholder="Choose a username"
                  autoComplete="username"
                  required
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-semibold">
                  Password
                </Label>
                <Input
                  id="password"
                  ref={passwordRef}
                  type="password"
                  placeholder="Choose a password"
                  autoComplete="new-password"
                  required
                  className="h-11"
                />
              </div>
              {error && (
                <p className="text-sm font-medium text-destructive">{error}</p>
              )}
            </CardContent>

            <CardFooter className="flex flex-col gap-4 border-t px-6 py-6">
              <Button
                type="submit"
                className="h-11 w-full text-base font-semibold"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Creating account…
                  </>
                ) : (
                  "Create account"
                )}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link
                  href="/signin"
                  className="font-semibold text-foreground underline-offset-4 hover:underline"
                >
                  Sign in
                </Link>
              </p>
            </CardFooter>
          </form>
        </Card>
      </main>
    </div>
  )
}
