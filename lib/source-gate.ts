// A deterministic "read before you answer" gate for the tool loop.
//
// Prompting alone was not reliable: on a question naming both Notion and Drive, the model sometimes ran
// a single bad Drive search (0 hits, or an unrelated PDF), never retried, never read anything, and
// answered from Notion alone without saying so. This gate uses the AI SDK's prepareStep hook to make
// that impossible: while a source the user named has not had a document successfully read, the next
// step is restricted to that source's tools and a tool call is required (the model cannot answer yet).
//
// It releases once the source has been read, or once searching has clearly failed (3 misses, or 6
// attempts overall), so a genuine "nothing relevant exists" still resolves with an honest answer.

type Part = { type: string; toolName?: string; output?: unknown };
export type GateStep = { content: ReadonlyArray<Part> };

type SourceSpec = {
  name: "drive" | "notion";
  named: RegExp; // does the question ask for this source?
  search: string;
  read: string;
  isEmptySearch: (output: unknown) => boolean;
};

const listLength = (output: unknown, key: string): number => {
  const list = (output as { data?: Record<string, unknown> } | undefined)?.data?.[key];
  return Array.isArray(list) ? list.length : 0;
};

const SOURCES: SourceSpec[] = [
  {
    name: "drive",
    named: /\b(google\s+)?drive\b|\bgoogle\s+(docs?|sheets?|slides?)\b/i,
    search: "drive_file_list",
    read: "drive_file_export_get",
    isEmptySearch: (o) => listLength(o, "items") === 0,
  },
  {
    name: "notion",
    named: /\bnotion\b/i,
    search: "notion_search_create",
    read: "notion_markdown_get",
    isEmptySearch: (o) => listLength(o, "results") === 0,
  },
];

export const MAX_MISSES = 3; // searches that found nothing (or errored)
export const MAX_ATTEMPTS = 6; // total search/read attempts, hit or miss

export type SourceState = { source: string; named: boolean; read: boolean; misses: number; attempts: number; active: boolean };

export function sourceStates(question: string, steps: ReadonlyArray<GateStep>): SourceState[] {
  return SOURCES.map((s) => {
    let read = false;
    let misses = 0;
    let attempts = 0;
    for (const step of steps) {
      for (const part of step.content) {
        if (part.toolName === s.search) {
          if (part.type === "tool-result") {
            attempts++;
            if (s.isEmptySearch(part.output)) misses++;
          } else if (part.type === "tool-error") {
            attempts++;
            misses++;
          }
        } else if (part.toolName === s.read) {
          if (part.type === "tool-result") read = true;
          else if (part.type === "tool-error") attempts++; // e.g. tried to read a PDF
        }
      }
    }
    const named = s.named.test(question);
    const exhausted = misses >= MAX_MISSES || attempts >= MAX_ATTEMPTS;
    return { source: s.name, named, read, misses, attempts, active: named && !read && !exhausted };
  });
}

// Returns the prepareStep override for the next step, or {} to leave the model unrestricted.
export function gateForNextStep(
  question: string,
  steps: ReadonlyArray<GateStep>,
): { activeTools?: string[]; toolChoice?: "required" } {
  const active = sourceStates(question, steps).filter((s) => s.active);
  if (active.length === 0) return {};
  const tools = SOURCES.filter((s) => active.some((a) => a.source === s.name)).flatMap((s) => [s.search, s.read]);
  return { activeTools: tools, toolChoice: "required" };
}
