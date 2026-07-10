import Link from "next/link"
import {
  Brain,
  FileText,
  Layers,
  Quote,
  Search,
  Upload,
} from "lucide-react"

import { RetrievalDiagram } from "@/components/retrieval-diagram"
import { SiteHeader } from "@/components/site-header"
import { Button } from "@/components/ui/button"

const capabilities = [
  {
    icon: Upload,
    title: "Ingest without ceremony",
    description:
      "PDFs, slides, images, notes — files hit object storage on a presigned URL and the pipeline takes over.",
  },
  {
    icon: Search,
    title: "Hybrid retrieval",
    description:
      "BM25 and vectors run together, fuse with RRF, then rerank so exact matches and semantic hits both surface.",
  },
  {
    icon: Brain,
    title: "Memory agents can use",
    description:
      "Chunks carry summaries, entities, pages, and tags — context built for agents that need real company knowledge.",
  },
  {
    icon: Quote,
    title: "Answers with receipts",
    description:
      "Every claim can point back to the chunk, page, and document. No black-box summaries.",
  },
]

const pipeline = [
  {
    title: "Upload",
    description: "Presigned put straight to MinIO — your bytes never detour through the app server.",
  },
  {
    title: "Process",
    description: "Workers parse, chunk, enrich, and embed on Redis Streams while you keep working.",
  },
  {
    title: "Retrieve",
    description: "Lexical + vector search fuse and rerank into the shortlist the model actually sees.",
  },
  {
    title: "Reason",
    description: "The LLM answers from your index, with citations you can open and verify.",
  },
]

const indexTags = [
  { label: "PDF", icon: FileText },
  { label: "Hybrid search", icon: Search },
  { label: "Citations", icon: Quote },
  { label: "Async workers", icon: Layers },
]

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex-1">
        {/* Hero — thesis + signature retrieval diagram */}
        <section className="relative mx-auto max-w-6xl px-4 pt-16 pb-20 sm:px-6 sm:pt-24 sm:pb-28">
          <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-10">
            <div className="lg:col-span-6">
              <p className="mb-5 font-mono text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
                Organizational memory OS
              </p>
              <h1 className="font-display text-[2.75rem] leading-[1.05] font-medium tracking-tight text-foreground sm:text-6xl lg:text-[4rem]">
                Your company{" "}
                <span className="font-script text-foreground">remembers</span>
                <span className="text-muted-foreground">.</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
                RecallOS turns documents into searchable memory: hybrid retrieval,
                source-grounded answers, and a pipeline agents can actually trust.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Button size="lg" className="h-11 px-7 text-base font-medium" asChild>
                  <Link href="/signup">Start free</Link>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="h-11 border-border/90 bg-card/60 px-7 text-base backdrop-blur-sm"
                  asChild
                >
                  <Link href="/signin">Sign in</Link>
                </Button>
              </div>
              <p className="mt-6 max-w-md text-sm text-muted-foreground">
                Built for teams that need{" "}
                <span className="font-medium text-foreground">receipts</span>, not
                vibes — BM25 + vectors, citations on every answer.
              </p>
            </div>

            <div className="lg:col-span-6">
              <RetrievalDiagram />
            </div>
          </div>
        </section>

        {/* Capability list — rows, not equal icon cards */}
        <section className="border-y border-border/70 bg-card/40">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <div className="mb-10 max-w-2xl">
              <h2 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">
                From raw files to{" "}
                <span className="font-script text-foreground">grounded</span> answers
              </h2>
              <p className="mt-3 text-lg text-muted-foreground">
                Not another drive. A continuous path from upload to citation.
              </p>
            </div>

            <ul className="divide-y divide-border/80 border-y border-border/80">
              {capabilities.map((item) => (
                <li
                  key={item.title}
                  className="grid gap-3 py-6 sm:grid-cols-[auto_1fr] sm:items-start sm:gap-6"
                >
                  <span className="flex size-10 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-muted-foreground">
                    <item.icon className="size-5" />
                  </span>
                  <div>
                    <h3 className="font-display text-xl font-medium tracking-tight">
                      {item.title}
                    </h3>
                    <p className="mt-1.5 max-w-2xl text-base leading-relaxed text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Pipeline as a real sequence with connector */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="mb-12 max-w-2xl">
            <p className="mb-3 font-mono text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
              Pipeline
            </p>
            <h2 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">
              Async by design
            </h2>
            <p className="mt-3 text-lg text-muted-foreground">
              Upload once. Process in the background. Search forever.
            </p>
          </div>

          <ol className="relative grid gap-0 sm:grid-cols-2 lg:grid-cols-4">
            {pipeline.map((step, index) => (
              <li
                key={step.title}
                className="relative border-t border-border/80 pt-6 pr-0 pb-8 sm:pr-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pr-0 lg:pl-6 first:lg:border-l-0 first:lg:pl-0"
              >
                <div className="mb-4 flex items-baseline gap-3">
                  <span className="font-mono text-sm font-semibold text-muted-foreground tabular-nums">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="font-display text-xl font-medium tracking-tight">
                    {step.title}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
                  {step.description}
                </p>
              </li>
            ))}
          </ol>
        </section>

        {/* Ready to index */}
        <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-20">
          <div className="archive-grid relative overflow-hidden rounded-xl border border-border/80 bg-card/70 px-6 py-10 sm:px-10">
            <div className="relative flex flex-col gap-8">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
                <div className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-muted-foreground">
                  <FileText className="size-6" />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <h3 className="font-display text-2xl font-medium tracking-tight">
                    Ready for your documents
                  </h3>
                  <p className="max-w-2xl text-base text-muted-foreground">
                    PDFs today — slides, images, notes, and conversations as the
                    pipeline grows. Hybrid search over every chunk you index.
                  </p>
                </div>
              </div>
              {/* Even 2×2 / 4-col grid so chips align instead of wrapping unevenly */}
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {indexTags.map((item) => (
                  <li key={item.label}>
                    <span className="flex h-full min-h-11 items-center justify-center gap-2 rounded-lg border border-border/90 bg-background/80 px-3 py-2.5 text-center text-sm font-medium text-foreground">
                      <item.icon
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <span className="leading-none">{item.label}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6 sm:pb-32">
          <div className="memory-glow relative overflow-hidden rounded-2xl border border-primary/20 bg-primary px-6 py-14 text-center text-primary-foreground sm:px-12">
            <div className="pointer-events-none absolute inset-0 opacity-30 archive-grid" />
            <div className="relative">
              <h2 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">
                Start building memory
              </h2>
              <p className="mx-auto mt-3 max-w-md text-base text-primary-foreground/80 sm:text-lg">
                Create an account, upload a document, and let RecallOS index what
                your organization already knows.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Button
                  size="lg"
                  className="h-11 bg-card px-8 text-base font-medium text-foreground hover:bg-card/90"
                  asChild
                >
                  <Link href="/signup">Create account</Link>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="h-11 border-primary-foreground/30 bg-transparent px-8 text-base text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
                  asChild
                >
                  <Link href="/dashboard">Open dashboard</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/80">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <span className="flex items-center gap-2 text-foreground">
            <span className="font-display text-base tracking-tight">RecallOS</span>
          </span>
          <span className="font-script text-lg text-muted-foreground">
            The operating system for organizational memory.
          </span>
        </div>
      </footer>
    </div>
  )
}
