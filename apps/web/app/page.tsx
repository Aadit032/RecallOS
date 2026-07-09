import Link from "next/link"
import {
  Brain,
  FileText,
  Layers,
  Quote,
  Search,
  Upload,
} from "lucide-react"

import { SiteHeader } from "@/components/site-header"
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

const docFeatures = [
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
        {/* Hero */}
        <section className="mx-auto max-w-5xl px-4 py-24 sm:px-6 sm:py-32">
          <div className="mx-auto max-w-3xl text-center">
            <Badge variant="secondary" className="mb-5 px-3 py-1 text-sm font-medium">
              Your company&apos;s{" "}
              <span className="font-script text-lg leading-none">second brain</span>
            </Badge>
            <h1 className="font-display text-5xl font-medium tracking-tight sm:text-6xl lg:text-7xl">
              Store. Remember.
              <br />
              <span className="font-script text-[1.15em] font-normal text-muted-foreground sm:text-[1.1em]">
                Retrieve. Reason.
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
              RecallOS is an{" "}
              <strong className="font-semibold text-foreground">
                AI-native knowledge OS
              </strong>
              . Ingest company documents, build searchable memory with hybrid
              retrieval, and let agents reason over what your organization
              actually knows.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" className="h-11 px-8 text-base" asChild>
                <Link href="/signup">Start free</Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-11 px-8 text-base"
                asChild
              >
                <Link href="/signin">Sign in</Link>
              </Button>
            </div>
          </div>
        </section>

        <Separator />

        {/* Features */}
        <section className="mx-auto max-w-5xl px-4 py-20 sm:px-6 sm:py-24">
          <div className="mb-12 max-w-2xl">
            <h2 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">
              Built for{" "}
              <span className="font-script text-[1.2em] text-muted-foreground">
                organizational memory
              </span>
            </h2>
            <p className="mt-3 text-lg text-muted-foreground">
              Not another drive. A pipeline from raw files to{" "}
              <strong className="font-semibold text-foreground">
                grounded answers
              </strong>
              .
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {features.map((feature) => (
              <Card key={feature.title} className="gap-3 py-6">
                <CardHeader className="gap-3 px-6">
                  <div className="flex size-10 items-center justify-center rounded-lg border bg-muted/50">
                    <feature.icon className="size-5 text-foreground" />
                  </div>
                  <CardTitle className="font-display text-xl font-medium tracking-tight">
                    {feature.title}
                  </CardTitle>
                  <CardDescription className="text-base leading-relaxed">
                    {feature.description}
                  </CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>

        <Separator />

        {/* How it works */}
        <section className="mx-auto max-w-5xl px-4 py-20 sm:px-6 sm:py-24">
          <div className="mb-12 max-w-2xl">
            <h2 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">
              How it works
            </h2>
            <p className="mt-3 text-lg text-muted-foreground">
              <span className="font-script text-2xl text-foreground">
                Async by design
              </span>{" "}
              — upload once, process in the background, search forever.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((item) => (
              <Card key={item.step} className="gap-2 py-6">
                <CardHeader className="gap-2 px-6">
                  <span className="font-mono text-sm font-medium text-muted-foreground">
                    {item.step}
                  </span>
                  <CardTitle className="font-display text-xl font-medium tracking-tight">
                    {item.title}
                  </CardTitle>
                  <CardDescription className="text-base leading-relaxed">
                    {item.description}
                  </CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>

        <Separator />

        {/* What you can index */}
        <section className="mx-auto max-w-5xl px-4 py-20 sm:px-6 sm:py-24">
          <Card className="border-dashed py-10">
            <CardContent className="flex flex-col items-center gap-6 px-6 text-center sm:flex-row sm:text-left">
              <div className="flex size-14 shrink-0 items-center justify-center rounded-xl border bg-muted/40">
                <FileText className="size-6" />
              </div>
              <div className="flex-1 space-y-2">
                <h3 className="font-display text-2xl font-medium tracking-tight">
                  Ready for your documents
                </h3>
                <p className="text-base text-muted-foreground">
                  PDFs today — slides, images, notes, and conversations as the
                  pipeline grows. Hybrid search over every chunk you index.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 sm:justify-end">
                {docFeatures.map((item) => (
                  <Badge key={item.label} variant="outline" className="gap-1.5 text-sm">
                    <item.icon className="size-3.5" />
                    {item.label}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-5xl px-4 pb-24 sm:px-6 sm:pb-32">
          <div className="rounded-2xl border bg-muted/30 px-6 py-14 text-center sm:px-12">
            <h2 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">
              Start building{" "}
              <span className="font-script text-[1.25em]">memory</span>
            </h2>
            <p className="mx-auto mt-3 max-w-md text-base text-muted-foreground sm:text-lg">
              Create an account, upload a document, and let RecallOS do the rest.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" className="h-11 px-8 text-base" asChild>
                <Link href="/signup">Create account</Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-11 px-8 text-base"
                asChild
              >
                <Link href="/chat">Open chat</Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-11 px-8 text-base"
                asChild
              >
                <Link href="/dashboard">Dashboard</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <span className="flex items-center gap-2 text-foreground">
            <Brain className="size-4" />
            <span className="font-display text-base tracking-wide">RecallOS</span>
          </span>
          <span className="font-script text-xl text-muted-foreground">
            The operating system for organizational memory.
          </span>
        </div>
      </footer>
    </div>
  )
}
