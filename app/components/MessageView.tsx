"use client";

import { memo, useMemo } from "react";
import { getToolName, isToolUIPart } from "ai";
import { Info, Sparkles, TriangleAlert, User } from "lucide-react";
import type { ChatMessage } from "../page";
import { Markdown } from "./Markdown";
import { ToolCard } from "./ToolCard";
import type { ToolPart } from "./ToolCard";
import { ToolGroup } from "./ToolGroup";

const GROUP_MIN = 3; // 3+ consecutive calls to the same tool collapse into one summary card

type Segment =
  | { kind: "text"; key: string; text: string }
  | { kind: "tool"; key: string; part: ToolPart }
  | { kind: "group"; key: string; parts: ToolPart[] };

// Turn the message's parts into what actually renders. Runs of the same tool are grouped generically (not
// per-tool); a text part ends a run. step-start and other non-visual parts are skipped so they can't split a run.
function buildSegments(parts: ChatMessage["parts"]): Segment[] {
  const segments: Segment[] = [];
  let run: ToolPart[] = [];

  const flush = () => {
    if (run.length >= GROUP_MIN) {
      segments.push({
        kind: "group",
        key: `group-${run[0].toolCallId}`,
        parts: run,
      });
    } else {
      for (const part of run)
        segments.push({ kind: "tool", key: part.toolCallId, part });
    }
    run = [];
  };

  parts.forEach((part, i) => {
    if (part.type === "text") {
      if (!part.text.trim()) return;
      flush();
      segments.push({ kind: "text", key: `text-${i}`, text: part.text });
    } else if (isToolUIPart(part)) {
      if (run.length && getToolName(run[0]) !== getToolName(part)) flush();
      run.push(part);
    }
  });
  flush();
  return segments;
}

function SegmentView({ segment }: Readonly<{ segment: Segment }>) {
  if (segment.kind === "text") return <Markdown text={segment.text} />;
  if (segment.kind === "group") return <ToolGroup parts={segment.parts} />;
  return <ToolCard part={segment.part} />;
}

function Avatar({ role }: Readonly<{ role: ChatMessage["role"] }>) {
  const Icon = role === "user" ? User : Sparkles;
  return (
    <span
      className={`grid size-7 shrink-0 place-items-center rounded-full ${
        role === "user"
          ? "bg-muted text-muted-foreground"
          : "bg-accent text-accent-foreground"
      }`}
    >
      <Icon className="size-3.5" aria-hidden />
    </span>
  );
}

// Memoized: `message` keeps its object identity until it is patched, so while one assistant message streams,
// every earlier message skips re-rendering.
export const MessageView = memo(function MessageView({
  message,
  working,
}: Readonly<{
  message: ChatMessage;
  working: boolean;
}>) {
  const segments = useMemo(() => buildSegments(message.parts), [message.parts]);

  if (message.role === "user") {
    const text = segments.find((s) => s.kind === "text");
    return (
      <div className="flex items-start justify-end gap-2.5">
        <div className="max-w-[85%] whitespace-pre-wrap wrap-break-word rounded-2xl rounded-tr-md bg-muted px-4 py-2.5 text-[15px] leading-relaxed">
          {text?.kind === "text" ? text.text : ""}
        </div>
        <Avatar role="user" />
      </div>
    );
  }

  const last = segments.at(-1);
  const hasText = segments.some((s) => s.kind === "text");
  // The stream may not tell us why it ended. If a finished run stops on a tool call with no answer text after
  // it, it was most likely cut off by the agent's step limit, so say how to carry on.
  const maybePartial =
    !working && !message.error && last !== undefined && last.kind !== "text";

  return (
    <div className="flex items-start gap-2.5">
      <Avatar role="assistant" />
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        {segments.map((s) => (
          <SegmentView key={s.key} segment={s} />
        ))}

        {working && !hasText && (
          <output className="flex items-center gap-1.5 py-1 text-sm text-muted-foreground">
            <span className="flex gap-1" aria-hidden>
              <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
              <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:150ms]" />
              <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:300ms]" />
            </span>
            Working...
          </output>
        )}

        {maybePartial && (
          <p className="flex items-start gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden />
            This run ended without a final answer and may have hit the step
            limit. Ask a follow-up (for example &quot;continue&quot;) to pick up
            where it left off.
          </p>
        )}

        {message.error && (
          <p
            className="flex items-start gap-1.5 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
            role="alert"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="min-w-0 wrap-break-word">{message.error}</span>
          </p>
        )}
      </div>
    </div>
  );
});
