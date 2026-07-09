import Link from "next/link"
import {
  Brain,
  FileText,
  Layers,
  Quote,
  Search,
  Upload,
} from "lucide-react"

import { ThemeToggle } from "@/components/theme-toggle"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

const features = [
  {
    icon: Upload,
    title: "Ingest anything",
    description:
      "Upload PDFs, slides, images, and notes. Files land in object storage and flow through an async pipeline automatically.",
  },
  {
    icon: Search,
    title: "Hybrid retrieval",
    description:
      "Combine BM25 keyword search with vector similarity, then fuse and rerank so you get exact matches and semantic hits together.",
  },
  {
    icon: Brain,
    title: "Agent-ready memory",
    description:
      "Chunk enrichment, embeddings, and long-term organizational memory — built for agents that need real company context.",
  },
  {
    icon: Quote,
    title: "Source-grounded answers",
    description:
      "Every response can point back to the chunk, page, and document it came from. No black-box summaries.",
  },
]

const steps = [
  {
    step: "01",
    title: "Upload",
    description: "Send files via presigned URLs straight to MinIO.",
  },
  {
    step: "02",
    title: "Process",
    description: "Workers parse, chunk, enrich, and embed in the background.",
  },
  {
    step: "03",
    title: "Retrieve",
    description: "Hybrid search + reranking surfaces the best context.",
  },
  {
    step: "04",
    title: "Reason",
    description: "LLMs answer with citations from your own knowledge base.",
  },
]

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Brain className="size-4" />
            </span>
            Recall-OS
          </Link>

          <nav className="flex items-center gap-1 sm:gap-2">
            <ThemeToggle />
            <Button variant="ghost" size="sm" asChild>
              <Link href="/signin">Sign in</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/signup">Get started</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto max-w-5xl px-4 py-20 sm:px-6 sm:py-28">
          <div className="mx-auto max-w-2xl text-center">
            <Badge variant="secondary" className="mb-4">
              Your company&apos;s second brain
            </Badge>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              Store. Remember.{" "}
              <span className="text-muted-foreground">Retrieve. Reason.</span>
            </h1>
            <p className="mt-5 text-base text-muted-foreground sm:text-lg">
              RecallOS is an AI-native knowledge OS. Ingest company documents,
              build searchable memory with hybrid retrieval, and let agents
              reason over what your organization actually knows.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" asChild>
                <Link href="/signup">Start free</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/signin">Sign in</Link>
              </Button>
            </div>
          </div>
        </section>

        <Separator />

        {/* Features */}
        <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mb-10 max-w-xl">
            <h2 className="text-2xl font-semibold tracking-tight">
              Built for organizational memory
            </h2>
            <p className="mt-2 text-muted-foreground">
              Not another drive. A pipeline from raw files to grounded answers.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {features.map((feature) => (
              <Card key={feature.title} className="gap-3 py-5">
                <CardHeader className="gap-2 px-5">
                  <div className="flex size-9 items-center justify-center rounded-md border bg-muted/50">
                    <feature.icon className="size-4 text-foreground" />
                  </div>
                  <CardTitle className="text-base">{feature.title}</CardTitle>
                  <CardDescription className="text-sm leading-relaxed">
                    {feature.description}
                  </CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>

        <Separator />

        {/* How it works */}
        <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mb-10 max-w-xl">
            <h2 className="text-2xl font-semibold tracking-tight">
              How it works
            </h2>
            <p className="mt-2 text-muted-foreground">
              Async by design — upload once, process in the background, search forever.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((item) => (
              <Card key={item.step} className="gap-2 py-5">
                <CardHeader className="gap-1 px-5">
                  <span className="font-mono text-xs text-muted-foreground">
                    {item.step}
                  </span>
                  <CardTitle className="text-base">{item.title}</CardTitle>
                  <CardDescription className="text-sm leading-relaxed">
                    {item.description}
                  </CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>

        <Separator />

        {/* What you can index */}
        <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
          <Card className="border-dashed py-8">
            <CardContent className="flex flex-col items-center gap-6 px-6 text-center sm:flex-row sm:text-left">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border bg-muted/40">
                <FileText className="size-5" />
              </div>
              <div className="flex-1 space-y-1">
                <h3 className="font-semibold">Ready for your documents</h3>
                <p className="text-sm text-muted-foreground">
                  PDFs today — slides, images, notes, and conversations as the
                  pipeline grows. Hybrid search over every chunk you index.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 sm:justify-end">
                <Badge variant="outline">PDF</Badge>
                <Badge variant="outline">Hybrid search</Badge>
                <Badge variant="outline">Citations</Badge>
                <Badge variant="outline">
                  <Layers className="size-3" />
                  Async workers
                </Badge>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-5xl px-4 pb-20 sm:px-6 sm:pb-28">
          <div className="rounded-xl border bg-muted/30 px-6 py-12 text-center sm:px-10">
            <h2 className="text-2xl font-semibold tracking-tight">
              Start building memory
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Create an account, upload a document, and let RecallOS do the rest.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" asChild>
                <Link href="/signup">Create account</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/dashboard">Go to dashboard</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <span className="flex items-center gap-2">
            <Brain className="size-3.5" />
            RecallOS
          </span>
          <span>The operating system for organizational memory.</span>
        </div>
      </footer>
    </div>
  )
}
