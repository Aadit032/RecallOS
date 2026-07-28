"use client";

import { useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signin } from "@/lib/api/auth";
import { getErrorMessage } from "@/lib/api";

export default function Signin() {
  const router = useRouter();
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const signinMutation = useMutation({
    mutationFn: ({
      username,
      password,
    }: {
      username: string;
      password: string;
    }) => signin(username, password),
    onSuccess: (data) => {
      localStorage.setItem("token", data.token);
      router.push("/dashboard");
    },
  });

  function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    const username = usernameRef.current?.value;
    const password = passwordRef.current?.value;
    if (!username || !password) return;
    signinMutation.mutate({ username, password });
  }

  const error = signinMutation.isError
    ? getErrorMessage(signinMutation.error, "Sign in failed. Try again.")
    : "";

  return (
    <div className="auth-stage auth-stage--signin relative flex min-h-screen flex-col overflow-hidden">
      <div className="page-art page-art--signin" aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="page-art-image" src="/bg-assets/shield.png" alt="" />
      </div>
      <header className="border-b border-border/80 bg-background/75 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 tracking-tight">
            <span className="font-display text-lg font-medium tracking-tight">
              RecallOS
            </span>
          </Link>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-16">
        <div className="archive-grid pointer-events-none absolute inset-0 opacity-30" />
        <div className="memory-glow relative w-full max-w-md overflow-hidden rounded-xl border border-border/80 bg-card">
          <div className="border-b border-border/80 px-6 py-8 sm:px-8">
            <p className="mb-2 font-mono text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
              Sign in
            </p>
            <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">
              Welcome back
            </h1>
            <p className="mt-2 text-base text-muted-foreground">
              Access your{" "}
              <span className="font-script text-foreground">
                organizational memory
              </span>
              .
            </p>
          </div>

          <form onSubmit={handleAuth}>
            <div className="space-y-5 px-6 py-8 sm:px-8">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-sm font-medium">
                  Username
                </Label>
                <Input
                  id="username"
                  ref={usernameRef}
                  placeholder="Enter username"
                  autoComplete="username"
                  required
                  className="h-11 bg-background/80"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium">
                  Password
                </Label>
                <Input
                  id="password"
                  ref={passwordRef}
                  type="password"
                  placeholder="Enter password"
                  autoComplete="current-password"
                  required
                  className="h-11 bg-background/80"
                />
              </div>
              {error && (
                <p
                  className="text-sm font-medium text-destructive"
                  role="alert"
                >
                  {error}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-4 border-t border-border/80 px-6 py-6 sm:px-8">
              <Button
                type="submit"
                className="h-11 w-full text-base font-medium"
                disabled={signinMutation.isPending}
              >
                {signinMutation.isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Signing in…
                  </>
                ) : (
                  "Sign in"
                )}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Don&apos;t have an account?{" "}
                <Link
                  href="/signup"
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  Create one
                </Link>
              </p>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
