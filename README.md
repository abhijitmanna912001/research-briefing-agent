# Cross-Source Research Briefing Agent

A research briefing agent that answers questions from your own Google Drive and
Notion, and can save the result as a Notion page or a Gmail draft when asked. It uses
the Vercel AI SDK for the model loop and [Swytchcode](https://swytchcode.com)
(`@swytchcode/runtime`) to execute the Drive, Notion and Gmail calls instead of
hand-rolled API clients. The chat UI streams the answer together with a live trace of
every tool call.

## Architecture

```
chat UI  ->  POST /api/agent  ->  streamText tool loop  ->  lib/tools.ts wrappers  ->  Swytchcode  ->  Drive / Notion / Gmail
   ^                                        |
   └──────── streamed answer + tool-call trace ┘
```

See **[docs/architecture.md](docs/architecture.md)** for the full diagram and for why
the wrapper layer in `lib/tools.ts` exists: it simplifies the generated tool schemas,
forces the API versions and parameters each provider needs, and turns upstream HTTP
errors into real tool errors.

## Project structure

- `app/page.tsx` — chat UI. Posts the question (plus prior turns) to `/api/agent`,
  renders the streamed answer, and shows each tool call as it runs (running / done /
  failed).
- `app/api/agent/route.ts` — the agent. Validates the request, runs `streamText` with
  the system prompt and tools (capped at 12 steps), and streams text and tool events
  back.
- `lib/tools.ts` — loads the Swytchcode tools and wraps them (see the architecture doc).
- `scripts/test-notion.mjs` — live probe of the Notion tools and their wrappers.
  Documents the `Notion-Version` quirk. Run with `node scripts/test-notion.mjs`.
- `.swytchcode/` — local Swytchcode state (fetched provider bundles, enabled methods in
  `tooling.json`). Managed by the `swytchcode` CLI; do not hand-edit.
- `.env.local.example` — copy to `.env.local` and fill in `OPENAI_API_KEY`.

## Swytchcode providers and enabled methods

Provider auth (Drive, Notion, Gmail) is handled by Swytchcode, not env vars.

| Toolkit | Fetch command | Enabled methods |
|---|---|---|
| Google Drive (`drive`) | `swytchcode get "Google Drive"` | `drive.file.list`, `drive.file.export.get` |
| Notion (`notion`) | `swytchcode get notion` | `notion.search.create`, `notion.markdown.get`, `notion.page.create` |
| Gmail (`gmail`) | `swytchcode get gmail` | `gmail.user.drafts.create` |

`swytchcode list methods <toolkit>` shows everything a provider offers, and
`swytchcode add method <canonical_id>` enables another one. Toolkit names passed to
`swx.tools.get()` match the integration names in `tooling.json`, so Drive is `drive`
(not `google-drive`).

## Getting Started

```bash
cp .env.local.example .env.local   # then set OPENAI_API_KEY
swytchcode auth connect google-drive
swytchcode auth connect notion
swytchcode auth connect gmail
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and ask something like
"Summarize what my Notion and Drive say about Project X". Only ask it to save or draft
when you want that: it creates Notion pages and Gmail drafts only on request (drafts
are never sent). If a tool fails, the agent says so and asks what to do next.

Do not set `SWYTCHCODE_BIN` to the npm-installed `swytchcode` wrapper script: the
wrapper treats it as the real binary and spawns itself in a loop. Leave it unset.
