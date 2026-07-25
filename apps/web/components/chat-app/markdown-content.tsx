"use client"

import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"

import "katex/dist/katex.min.css"

/** Turn bare http(s) URLs into markdown links (skip ones already inside ](…)). */
function linkifyBareUrls(text: string): string {
   return text.replace(
      /(?<!\]\()(?<!["'(=])(https?:\/\/[^\s<>[\]`"']+[^\s<>[\]`"'.,;:!?)]?)/g,
      (url) => {
         let href = url
         let trailing = ""
         while (/[.,;:!?)]$/.test(href)) {
            trailing = href.slice(-1) + trailing
            href = href.slice(0, -1)
         }
         if (!href) return url
         return `[${href}](${href})${trailing}`
      }
   )
}

export function MarkdownContent({ content }: { content: string }) {
   const processed = linkifyBareUrls(content)

   return (
      <Markdown
         remarkPlugins={[remarkGfm, remarkMath]}
         rehypePlugins={[rehypeKatex]}
         components={{
            p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
            pre: ({ children }) => (
               <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 text-xs">{children}</pre>
            ),
            code: ({ className, children, ...props }) => {
               const isBlock = className?.startsWith("language-")
               if (isBlock) return <code className={className} {...props}>{children}</code>
               return <code className="rounded bg-muted/50 px-1.5 py-0.5 text-xs" {...props}>{children}</code>
            },
            ul: ({ children }) => <ul className="mb-2 list-outside list-disc space-y-1 pl-5">{children}</ul>,
            ol: ({ children }) => <ol className="mb-2 list-outside list-decimal space-y-1 pl-5">{children}</ol>,
            li: ({ children }) => <li className="pl-1">{children}</li>,
            h1: ({ children }) => <h1 className="mb-2 text-lg font-semibold">{children}</h1>,
            h2: ({ children }) => <h2 className="mb-2 text-base font-semibold">{children}</h2>,
            h3: ({ children }) => <h3 className="mb-1 text-sm font-semibold">{children}</h3>,
            blockquote: ({ children }) => (
               <blockquote className="border-l-2 border-muted-foreground/30 pl-3 italic text-muted-foreground">{children}</blockquote>
            ),
            table: ({ children }) => <div className="mb-2 overflow-x-auto"><table className="w-full text-sm">{children}</table></div>,
            th: ({ children }) => <th className="border-b border-border px-2 py-1 text-left font-medium">{children}</th>,
            td: ({ children }) => <td className="border-b border-border px-2 py-1">{children}</td>,
            a: ({ children, href }) => (
               <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-2 decoration-primary/60 hover:decoration-primary break-words"
               >
                  {children}
               </a>
            ),
            hr: () => <hr className="my-3 border-border" />,
         }}
      >
         {processed}
      </Markdown>
   )
}
