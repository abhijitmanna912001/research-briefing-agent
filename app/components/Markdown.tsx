"use client";

import { memo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText, HardDrive, Mail } from "lucide-react";

const CITE_ICONS = { Drive: HardDrive, Notion: FileText, Gmail: Mail } as const;

// The system prompt has the model cite sources as "[Drive: file name]" / "[Notion: page title]". Bare
// brackets are not markdown links, so rewrite them into a private "cite:" link that the `a` renderer below
// turns into a small chip. Already-linked citations "[Notion: x](https://...)" are left alone.
function withCitations(text: string): string {
  return text.replace(
    /\[(Drive|Notion|Gmail): ([^\]\n]+)\](?!\()/g,
    (_m, src: string, name: string) => {
      return `[${src}: ${name.replace(/[[\]()]/g, "")}](cite:${src})`;
    },
  );
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mb-2 mt-5 text-xl font-semibold first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-5 text-lg font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1.5 mt-4 text-base font-semibold first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1 mt-3 text-sm font-semibold first:mt-0">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="my-2 list-disc space-y-1 pl-5 marker:text-muted-foreground">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-muted-foreground">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-border pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-border" />,
  a: ({ href, children }) => {
    if (href?.startsWith("cite:")) {
      const Icon =
        CITE_ICONS[href.slice(5) as keyof typeof CITE_ICONS] ?? FileText;
      return (
        <span className="mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 align-baseline text-xs text-muted-foreground">
          <Icon className="size-3 shrink-0 text-accent" aria-hidden />
          <span className="truncate">{children}</span>
        </span>
      );
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent underline underline-offset-2 hover:opacity-80"
      >
        {children}
      </a>
    );
  },
  // Inline code vs fenced blocks: blocks arrive inside <pre> (styled below) and carry a language class or newlines.
  code: ({ className, children }) => {
    const isBlock = Boolean(className) || String(children).includes("\n");
    return isBlock ? (
      <code className="font-mono">{children}</code>
    ) : (
      <code className="rounded bg-code px-1 py-0.5 font-mono text-[0.85em]">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-3 max-w-full overflow-x-auto rounded-lg bg-code p-3 font-mono text-xs leading-relaxed">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-3 max-w-full overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-left text-sm">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-border bg-muted px-3 py-1.5 font-medium">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-border px-3 py-1.5 last:border-b-0">
      {children}
    </td>
  ),
};

const urlTransform = (url: string) =>
  url.startsWith("cite:") ? url : defaultUrlTransform(url);

// Memoized on the text: while one message streams, the finished ones above it never re-parse their markdown.
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="min-w-0 wrap-break-word text-[15px]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        urlTransform={urlTransform}
      >
        {withCitations(text)}
      </ReactMarkdown>
    </div>
  );
});
