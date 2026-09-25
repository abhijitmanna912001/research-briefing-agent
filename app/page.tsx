"use client";

import { useState } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");

  function handleSubmit(e: React.SubmitEvent) {
    e.preventDefault();
    if (!input.trim()) return;

    // Wired up to POST /api/agent once the agent loop exists tomorrow.
    setMessages((prev) => [...prev, { role: "user", content: input }]);
    setInput("");
  }

  return (
    <div className="flex flex-col flex-1 max-w-2xl mx-auto w-full p-4">
      <h1 className="text-xl font-semibold mb-4">Research Briefing Agent</h1>

      <div className="flex-1 flex flex-col gap-2 mb-4 overflow-y-auto">
        {messages.map((message, i) => (
          <div key={`${message.role}-${i}-${message.content}`} className="text-sm">
            <span className="font-medium">{message.role}: </span>
            {message.content}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask for a research briefing..."
          className="flex-1 border rounded px-3 py-2"
        />
        <button type="submit" className="border rounded px-4 py-2">
          Send
        </button>
      </form>
    </div>
  );
}
