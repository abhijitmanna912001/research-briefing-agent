"use client";

import { useEffect, useRef, useState } from "react";
import { readUIMessageStream } from "ai";
import type { UIMessage, UIMessageChunk } from "ai";
import { BookOpenCheck, FileText, HardDrive, Mail } from "lucide-react";
import { Composer } from "./components/Composer";
import { EmptyState } from "./components/EmptyState";
import { MessageView } from "./components/MessageView";

export type ChatMessage = { id: string; role: "user" | "assistant"; parts: UIMessage["parts"]; error?: string };

function textOf(message: ChatMessage) {
  return message.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
}

// The server sends Server-Sent Events: each `data: {json}` line is one UIMessageChunk
// (text delta, tool-input-available, tool-output-available, ...). Decode them into a stream.
function sseToChunks(body: ReadableStream<Uint8Array>, onError: (e: string) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return controller.close();
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        let enqueued = false;
        for (const event of events) {
          const data = event.split("\n").find((l) => l.startsWith("data: "))?.slice(6);
          if (!data || data === "[DONE]") continue;
          const chunk = JSON.parse(data) as UIMessageChunk;
          if (chunk.type === "error") onError(chunk.errorText);
          else {
            controller.enqueue(chunk);
            enqueued = true;
          }
        }
        if (enqueued) return;
      }
    },
  });
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const nextId = useRef(0);
  const scrollRef = useRef<HTMLElement>(null);
  const stickRef = useRef(true); // follow new content only while the user is at (or near) the bottom
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || busy) return;
    stickRef.current = true; // jump to the new turn even if the user had scrolled up

    const userId = `u${nextId.current++}`;
    const assistantId = `a${nextId.current++}`;
    // Prior turns go to the server as plain text history (tool traces are not replayed).
    const history = messages
      .map((m) => ({ role: m.role, content: textOf(m) }))
      .filter((m) => m.content);

    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", parts: [{ type: "text", text: question }] },
      { id: assistantId, role: "assistant", parts: [] },
    ]);
    setInput("");
    setBusy(true);

    const update = (patch: Partial<ChatMessage>) =>
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)));

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Request failed (${res.status})`);
      }

      let streamError: string | undefined;
      const chunks = sseToChunks(res.body, (msg) => (streamError = msg));
      for await (const ui of readUIMessageStream({ stream: chunks })) {
        update({ parts: ui.parts });
      }
      if (streamError) update({ error: streamError });
    } catch (err) {
      update({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  function pickExample(prompt: string) {
    setInput(prompt);
    inputRef.current?.focus();
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="border-b border-border px-4 py-3">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
            <BookOpenCheck className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold leading-tight">Research Briefing Agent</h1>
            <p className="truncate text-xs text-muted-foreground">Cited briefings from your Drive and Notion</p>
          </div>
          <div className="hidden items-center gap-2 text-muted-foreground sm:flex" aria-label="Connected sources: Drive, Notion, Gmail">
            <HardDrive className="size-4" aria-hidden />
            <FileText className="size-4" aria-hidden />
            <Mail className="size-4" aria-hidden />
          </div>
        </div>
      </header>

      <main
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
        className="flex-1 overflow-y-auto"
      >
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-4 py-6">
          {messages.length === 0 ? (
            <EmptyState onPick={pickExample} />
          ) : (
            messages.map((message, i) => (
              <MessageView
                key={message.id}
                message={message}
                working={busy && message.role === "assistant" && i === messages.length - 1}
              />
            ))
          )}
        </div>
      </main>

      <Composer value={input} onChange={setInput} onSubmit={handleSubmit} busy={busy} textareaRef={inputRef} />
    </div>
  );
}
