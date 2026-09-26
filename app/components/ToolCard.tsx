"use client";

import { getToolName } from "ai";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import {
  CircleCheck,
  CircleX,
  FileText,
  HardDrive,
  LoaderCircle,
  Mail,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { hasMoreDetail, summarizeError } from "./errors";

// isToolUIPart narrows to both static ("tool-<name>") and dynamic tool parts.
export type ToolPart = ToolUIPart | DynamicToolUIPart;
export type ToolStatus = "running" | "done" | "error";

// Tool name (sanitized canonical id) -> what to show while it runs / after it finishes.
export const TOOL_LABELS: Record<string, { running: string; done: string }> = {
  drive_file_list: {
    running: "Searching Google Drive...",
    done: "Searched Google Drive",
  },
  drive_file_export_get: {
    running: "Reading file from Google Drive...",
    done: "Read file from Google Drive",
  },
  notion_search_create: {
    running: "Searching Notion...",
    done: "Searched Notion",
  },
  notion_markdown_get: {
    running: "Reading page from Notion...",
    done: "Read page from Notion",
  },
  notion_page_create: {
    running: "Creating Notion page...",
    done: "Created Notion page",
  },
  gmail_user_drafts_create: {
    running: "Drafting Gmail message...",
    done: "Created Gmail draft",
  },
};

// Which provider a tool belongs to (icon + small tag on the card).
export const TOOL_SOURCE: Record<string, { name: string; Icon: LucideIcon }> = {
  drive_file_list: { name: "Drive", Icon: HardDrive },
  drive_file_export_get: { name: "Drive", Icon: HardDrive },
  notion_search_create: { name: "Notion", Icon: FileText },
  notion_markdown_get: { name: "Notion", Icon: FileText },
  notion_page_create: { name: "Notion", Icon: FileText },
  gmail_user_drafts_create: { name: "Gmail", Icon: Mail },
};

// Pull the most informative bit of the tool input for display (search terms, ids, ...).
export function inputSummary(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const i = input as Record<string, unknown>;
  const body = (i.body ?? {}) as Record<string, unknown>;
  const hint =
    i.q ??
    i.query ??
    body.query ??
    i.fileId ??
    i.page_id ??
    i.title ??
    i.subject ??
    "";
  return typeof hint === "string" ? hint : "";
}

export function toolStatus(part: ToolPart): ToolStatus {
  if (part.state === "output-error") return "error";
  if (part.state === "output-available") return "done";
  return "running";
}

export function StatusIcon({ status }: Readonly<{ status: ToolStatus }>) {
  if (status === "running")
    return (
      <LoaderCircle
        aria-label="Running"
        className="size-4 shrink-0 animate-spin text-muted-foreground"
      />
    );
  if (status === "done")
    return (
      <CircleCheck aria-label="Done" className="size-4 shrink-0 text-success" />
    );
  return (
    <CircleX aria-label="Failed" className="size-4 shrink-0 text-danger" />
  );
}

export function SourceTile({ name }: Readonly<{ name: string }>) {
  const Icon = TOOL_SOURCE[name]?.Icon ?? Wrench;
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-accent">
      <Icon className="size-4" aria-hidden />
    </span>
  );
}

// A one-line summary is always visible; the raw error (often the CLI's whole log) sits behind a disclosure,
// in the same monospace scrolling box as the input JSON below it.
function ToolError({ text }: Readonly<{ text: string }>) {
  const summary = summarizeError(text) || "Tool call failed";
  return (
    <div className="px-3 pb-2">
      <p className="wrap-break-word text-xs text-danger">{summary}</p>
      {hasMoreDetail(text, summary) && (
        <details className="mt-1">
          <summary className="cursor-pointer select-none font-mono text-xs text-muted-foreground hover:text-foreground">
            Full error
          </summary>
          <pre className="mt-1.5 max-h-64 max-w-full overflow-auto rounded-lg bg-code p-3 font-mono text-xs leading-relaxed">
            {text}
          </pre>
        </details>
      )}
    </div>
  );
}

export function ToolCard({ part }: Readonly<{ part: ToolPart }>) {
  const name = getToolName(part);
  const label = TOOL_LABELS[name] ?? {
    running: `Running ${name}...`,
    done: `Ran ${name}`,
  };
  const source = TOOL_SOURCE[name]?.name;
  const status = toolStatus(part);
  const hint = inputSummary(part.input);
  const title =
    status === "done"
      ? label.done
      : status === "error"
        ? `Failed: ${label.running.replace(/\.\.\.$/, "")}`
        : label.running;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card text-sm">
      <div className="flex items-center gap-3 px-3 py-2">
        <SourceTile name={name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate font-medium">{title}</span>
            {source && (
              <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {source}
              </span>
            )}
          </div>
          {hint && (
            <div className="truncate text-xs text-muted-foreground">{hint}</div>
          )}
        </div>
        <StatusIcon status={status} />
      </div>

      {status === "error" && part.errorText && (
        <ToolError text={part.errorText} />
      )}

      <details className="border-t border-border">
        <summary className="cursor-pointer select-none px-3 py-1.5 font-mono text-xs text-muted-foreground hover:text-foreground">
          {name}
        </summary>
        {/* The JSON scrolls inside its own box so a long value never widens the page. */}
        <pre className="mx-3 mb-3 max-w-full overflow-x-auto rounded-lg bg-code p-3 font-mono text-xs leading-relaxed">
          {JSON.stringify(part.input, null, 2)}
        </pre>
      </details>
    </div>
  );
}
