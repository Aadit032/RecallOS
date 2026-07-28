"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function Home() {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => setAuthed(Boolean(localStorage.getItem("token"))), []);
  useEffect(() => {
    if (authed) router.replace("/dashboard");
  }, [authed, router]);

  if (authed === null || authed) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="portal-stage relative flex min-h-screen flex-col bg-background">
      <header className="portal-header sticky top-0 z-20 border-b backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link
            href="/"
            className="portal-wordmark text-xl font-semibold text-foreground"
          >
            RecallOS
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            <Link
              href="/signin"
              className="hidden text-muted-foreground transition-colors hover:text-foreground sm:block"
            >
              Sign in
            </Link>
            <Button asChild className="h-9 rounded-sm px-4 text-sm font-medium">
              <Link href="/signup">
                Create account <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="relative z-0 flex flex-1 flex-col">
        <div className="page-art page-art--home" aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="nous-art-backdrop"
            src="/bg-assets/backdrop-figure.webp"
            alt=""
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="nous-art-hero"
            src="/bg-assets/hero-figure.webp"
            alt=""
          />
        </div>
        <section className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-5 py-24 sm:px-8 lg:py-32">
          <p className="mb-7 font-mono text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
            RecallOS / knowledge operating system
          </p>
          <h1 className="max-w-4xl text-5xl font-medium leading-[0.94] tracking-[-0.075em] text-foreground sm:text-7xl lg:text-[6.75rem]">
            Your work, <br />
            <span className="text-muted-foreground">available to thought.</span>
          </h1>
          <div className="mt-10 flex max-w-md flex-col gap-6 sm:ml-[33.333%]">
            <p className="text-base leading-7 text-muted-foreground sm:text-lg">
              Put documents, calls, images, and research into one durable
              memory. Ask once; retain the context.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg" className="h-11 rounded-sm px-5">
                <Link href="/signup">
                  Start building memory <ArrowUpRight className="size-4" />
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="h-11 rounded-sm border-border bg-background/45 px-5 text-foreground hover:bg-accent"
              >
                <Link href="/signin">Sign in</Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="relative z-10 border-t border-border/80 bg-background/65 backdrop-blur-sm">
          <div className="mx-auto grid max-w-7xl divide-y divide-border/80 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {[
              [
                "01",
                "Ingest every format",
                "PDFs, images, audio, and video arrive in one searchable library.",
              ],
              [
                "02",
                "Retrieve the signal",
                "Hybrid search finds meaning, context, and the exact source.",
              ],
              [
                "03",
                "Keep the thread",
                "Chat over your accumulated company memory without starting over.",
              ],
            ].map(([number, title, body]) => (
              <div key={number} className="min-h-44 px-5 py-7 sm:px-8 sm:py-9">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {number}
                </span>
                <h2 className="mt-6 text-base font-medium tracking-tight text-foreground">
                  {title}
                </h2>
                <p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
