"use client";

import { useState } from "react";
import { getToolName } from "ai";
import { ChevronDown } from "lucide-react";
import {
  SourceTile,
  StatusIcon,
  ToolCard,
  toolStatus,
  TOOL_LABELS,
} from "./ToolCard";
import type { ToolPart, ToolStatus } from "./ToolCard";

// Summary line for a collapsed run of the same tool (e.g. "Created 8 Gmail drafts"). Tools without an entry
// fall back to a generic "<label> x N", so any repeated tool groups correctly.
const GROUP_TITLES: Record<
  string,
  { running: (n: number) => string; done: (n: number) => string }
> = {
  drive_file_list: {
    running: (n) => `Searching Google Drive (${n} searches)...`,
    done: (n) => `Ran ${n} Google Drive searches`,
  },
  drive_file_export_get: {
    running: (n) => `Reading ${n} files from Google Drive...`,
    done: (n) => `Read ${n} files from Google Drive`,
  },
  notion_search_create: {
    running: (n) => `Searching Notion (${n} searches)...`,
    done: (n) => `Ran ${n} Notion searches`,
  },
  notion_markdown_get: {
    running: (n) => `Reading ${n} pages from Notion...`,
    done: (n) => `Read ${n} pages from Notion`,
  },
  notion_page_create: {
    running: (n) => `Creating ${n} Notion pages...`,
    done: (n) => `Created ${n} Notion pages`,
  },
  gmail_user_drafts_create: {
    running: (n) => `Drafting ${n} Gmail messages...`,
    done: (n) => `Created ${n} Gmail drafts`,
  },
};

// One card for 3+ consecutive calls to the same tool. Individual cards are only mounted once expanded,
// so a run of dozens of calls stays cheap in the DOM until the user asks to see them.
export function ToolGroup({ parts }: Readonly<{ parts: ToolPart[] }>) {
  const [open, setOpen] = useState(false);
  const name = getToolName(parts[0]);
  const n = parts.length;

  const counts = parts.reduce<Record<ToolStatus, number>>(
    (acc, p) => ({ ...acc, [toolStatus(p)]: acc[toolStatus(p)] + 1 }),
    { running: 0, done: 0, error: 0 },
  );
  const finished = counts.done + counts.error;
  let status: ToolStatus = "done";
  if (counts.running > 0) status = "running";
  else if (counts.error > 0) status = "error";

  const label = TOOL_LABELS[name] ?? {
    running: `Running ${name}...`,
    done: `Ran ${name}`,
  };
  const titles = GROUP_TITLES[name];
  const title =
    status === "running"
      ? (titles?.running(n) ?? `${label.running} x${n}`)
      : (titles?.done(n) ?? `${label.done} x${n}`);

  let detail: string | null = null;
  if (status === "running") {
    const failed = counts.error ? `, ${counts.error} failed` : "";
    detail = `${finished} of ${n} complete${failed}`;
  } else if (counts.error) {
    detail = `${counts.error} of ${n} failed`;
  }

  return (
    <div className="rounded-xl border border-border bg-card text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-muted/60"
      >
        <SourceTile name={name} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{title}</div>
          {detail && (
            <div className="truncate text-xs text-muted-foreground">
              {detail}
            </div>
          )}
        </div>
        <StatusIcon status={status} />
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          {open ? "Hide" : "Show all"}
          <ChevronDown
            className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-border p-2">
          {parts.map((p) => (
            <ToolCard key={p.toolCallId} part={p} />
          ))}
        </div>
      )}
    </div>
  );
}
