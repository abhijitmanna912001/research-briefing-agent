"use client";

import { useRef, useState } from "react";
import { getToolName, isToolUIPart, readUIMessageStream } from "ai";
import type { UIMessage, UIMessageChunk } from "ai";

type ChatMessage = { id: string; role: "user" | "assistant"; parts: UIMessage["parts"]; error?: string };

// Tool name (sanitized canonical id) -> what to show while it runs / after it finishes.
const TOOL_LABELS: Record<string, { running: string; done: string }> = {
  drive_file_list: { running: "Searching Google Drive...", done: "Searched Google Drive" },
  drive_file_export_get: { running: "Reading file from Google Drive...", done: "Read file from Google Drive" },
  notion_search_create: { running: "Searching Notion...", done: "Searched Notion" },
  notion_markdown_get: { running: "Reading page from Notion...", done: "Read page from Notion" },
  notion_page_create: { running: "Creating Notion page...", done: "Created Notion page" },
  gmail_user_drafts_create: { running: "Drafting Gmail message...", done: "Created Gmail draft" },
};

function textOf(message: ChatMessage) {
  return message.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
}

// Pull the most informative bit of the tool input for display (search terms, ids, ...).
function inputSummary(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const i = input as Record<string, unknown>;
  const body = (i.body ?? {}) as Record<string, unknown>;
  const hint = i.q ?? body.query ?? i.fileId ?? i.page_id ?? "";
  return typeof hint === "string" ? hint : "";
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || busy) return;

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

  return (
    <div className="flex flex-col flex-1 max-w-2xl mx-auto w-full p-4">
      <h1 className="text-xl font-semibold mb-4">Research Briefing Agent</h1>

      <div className="flex-1 flex flex-col gap-4 mb-4 overflow-y-auto">
        {messages.map((message) => (
          <div key={message.id} className="text-sm">
            <div className="font-medium mb-1">{message.role === "user" ? "You" : "Agent"}</div>

            {message.parts.map((part, i) => {
              if (part.type === "text") {
                return (
                  <div key={i} className="whitespace-pre-wrap">
                    {part.text}
                  </div>
                );
              }
              if (isToolUIPart(part)) {
                const name = getToolName(part);
                const label = TOOL_LABELS[name] ?? { running: `Running ${name}...`, done: `Ran ${name}` };
                const failed = part.state === "output-error";
                const finished = part.state === "output-available" || failed;
                const hint = inputSummary(part.input);
                return (
                  <div key={i} className="my-1 rounded border px-2 py-1 text-xs text-gray-600">
                    <span>{failed ? "✗" : finished ? "✓" : "…"} </span>
                    <span>{finished ? label.done : label.running}</span>
                    {hint && <span className="text-gray-400"> — {hint}</span>}
                    {failed && <div className="text-red-600">{part.errorText}</div>}
                    <details className="mt-1">
                      <summary className="cursor-pointer text-gray-400">{name}</summary>
                      <pre className="overflow-x-auto">{JSON.stringify(part.input, null, 2)}</pre>
                    </details>
                  </div>
                );
              }
              return null;
            })}

            {message.role === "assistant" && busy && message === messages[messages.length - 1] && !message.error && (
              <div className="text-xs text-gray-400">Working...</div>
            )}
            {message.error && <div className="text-red-600">Error: {message.error}</div>}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask for a research briefing..."
          className="flex-1 border rounded px-3 py-2"
          disabled={busy}
        />
        <button type="submit" className="border rounded px-4 py-2" disabled={busy}>
          Send
        </button>
      </form>
    </div>
  );
}
