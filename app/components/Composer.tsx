"use client";

import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import { ArrowUp, LoaderCircle } from "lucide-react";

const MAX_HEIGHT = 200; // px: the textarea grows with its content up to this, then scrolls

type ComposerProps = Readonly<{
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  busy: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}>;

export function Composer({ value, onChange, onSubmit, busy, textareaRef }: ComposerProps) {
  const formRef = useRef<HTMLFormElement>(null);

  // Auto-grow: reset to auto so it can also shrink (e.g. after send clears the input), then fit the content.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value, textareaRef]);

  return (
    // Bottom padding respects the phone's safe area (home indicator); the viewport sets viewport-fit=cover.
    <div className="border-t border-border bg-background px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
      <form ref={formRef} onSubmit={onSubmit} className="mx-auto w-full max-w-3xl">
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 transition-colors focus-within:border-accent">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter inserts a newline. Ignore Enter while an IME is composing text.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                formRef.current?.requestSubmit();
              }
            }}
            rows={1}
            placeholder="Ask for a research briefing..."
            aria-label="Message"
            className="max-h-[200px] min-h-[2.25rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={busy || !value.trim()}
            aria-label={busy ? "Working" : "Send message"}
            className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <ArrowUp className="size-4" aria-hidden />}
          </button>
        </div>
        <p className="mt-2 hidden text-center text-[11px] text-muted-foreground sm:block">
          Enter to send, Shift+Enter for a new line. Answers cite their sources; Gmail drafts are never sent.
        </p>
      </form>
    </div>
  );
}
