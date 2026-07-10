/**
 * Signature visual: dual retrieval lanes (SPLADE + vectors) fuse into a
 * source-grounded answer — the product thesis in one panel.
 */
export function RetrievalDiagram() {
  return (
    <div
      className="memory-glow relative overflow-hidden rounded-xl border border-border/80 bg-card p-5 sm:p-6"
      aria-hidden="true"
    >
      <div className="archive-grid pointer-events-none absolute inset-0 opacity-40" />
      <div className="relative space-y-5">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
            Live retrieval
          </p>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
            <span className="size-1.5 animate-recall-pulse rounded-full bg-muted-foreground" />
            hybrid
          </span>
        </div>

        <div className="rounded-lg border border-border/80 bg-background/80 px-3.5 py-2.5">
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Query
          </p>
          <p className="mt-1 font-display text-lg leading-snug text-foreground sm:text-xl">
            How does hybrid retrieval rank chunks?
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Lane
            label="splade"
            subtitle="OpenSearch · lexical"
            hits={["exact term match", "title boost", "phrase proximity"]}
            delay="0s"
          />
          <Lane
            label="Vector"
            subtitle="Qdrant · semantic"
            hits={["embedding nn", "section summary", "entity overlap"]}
            delay="0.4s"
          />
        </div>

        <div className="relative flex items-center justify-center py-1">
          <div className="absolute inset-x-8 top-1/2 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
          <span className="relative rounded-full border border-primary/30 bg-primary/10 px-3 py-1 font-mono text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            RRF fuse → rerank
          </span>
        </div>

        <div className="rounded-lg border border-citation/35 bg-citation/10 px-3.5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] font-semibold tracking-wider text-citation-foreground uppercase">
              Answer
            </span>
            <CitationChip page="12" doc="architecture.pdf" />
            <CitationChip page="4" doc="q3-notes.md" />
          </div>
          <p className="mt-2 text-sm leading-relaxed text-foreground/90">
            SPLADE and vector lists fuse with reciprocal rank fusion; a cross-encoder
            reorders the shortlist before the LLM sees context.
          </p>
        </div>
      </div>
    </div>
  )
}

function Lane({
  label,
  subtitle,
  hits,
  delay,
}: {
  label: string
  subtitle: string
  hits: string[]
  delay: string
}) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-border/80 bg-muted/40 p-3">
      <div
        className="animate-lane-flow pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-foreground/10 to-transparent"
        style={{ animationDelay: delay }}
      />
      <p className="font-mono text-xs font-semibold tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>
      <ul className="mt-3 space-y-1.5">
        {hits.map((hit) => (
          <li
            key={hit}
            className="flex items-center gap-2 text-xs text-foreground/85"
          >
            <span className="size-1 shrink-0 rounded-full bg-muted-foreground/70" />
            {hit}
          </li>
        ))}
      </ul>
    </div>
  )
}

function CitationChip({ page, doc }: { page: string; doc: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-citation/40 bg-card px-1.5 py-0.5 font-mono text-[10px] text-citation-foreground">
      <span className="text-citation">p.{page}</span>
      <span className="text-muted-foreground">·</span>
      <span className="max-w-[7rem] truncate">{doc}</span>
    </span>
  )
}
