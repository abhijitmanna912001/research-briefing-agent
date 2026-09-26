"use client";

import { BookOpenCheck, FileText, HardDrive, Mail } from "lucide-react";

const EXAMPLES = [
  "Does AuditFlow satisfy the Build with Swytchcode buildathon requirements, based on Notion and Drive documentation?",
  "Summarize the Build with Swytchcode participant guide from my Google Drive.",
  "Create a Notion page summarizing what we know about AuditFlow's architecture from our documentation.",
  "Draft an email summarizing AuditFlow's initial architecture.",
];

export function EmptyState({ onPick }: Readonly<{ onPick: (prompt: string) => void }>) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-accent text-accent-foreground">
        <BookOpenCheck className="size-6" aria-hidden />
      </span>
      <h2 className="mt-4 text-xl font-semibold sm:text-2xl">Research Briefing Agent</h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        Searches your Google Drive and Notion, reads the best matches, and writes a briefing that cites its sources. It
        can also save the result to Notion or draft it in Gmail when you ask.
      </p>
      <div className="mt-3 flex items-center gap-3 text-muted-foreground" aria-hidden>
        <HardDrive className="size-4" />
        <FileText className="size-4" />
        <Mail className="size-4" />
      </div>

      <div className="mt-8 grid w-full max-w-2xl gap-2 text-left sm:grid-cols-2">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => onPick(example)}
            className="rounded-xl border border-border bg-card px-3.5 py-3 text-sm leading-snug transition-colors hover:border-accent hover:bg-muted"
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}
