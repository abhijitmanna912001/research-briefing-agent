# Cross-Source Research Briefing Agent

This app is a research briefing agent that pulls context from Google Drive, Notion,
and Gmail, then uses the Vercel AI SDK to synthesize a briefing. Tool execution
(calling out to those three services) is delegated to [Swytchcode](https://swytchcode.com)
via `@swytchcode/runtime` rather than hand-rolled API clients.

### Project structure

- `app/page.tsx` — minimal chat-style UI (input box + message list). Not yet wired
  up to the backend.
- `app/api/agent/route.ts` — API route stub for the agent loop. Currently an empty
  `POST` handler; the model call + Swytchcode tool-calling loop will be implemented
  here.
- `.swytchcode/` — local Swytchcode state (fetched provider bundles, enabled
  methods in `tooling.json`). Managed by the `swytchcode` CLI — do not hand-edit.
- `.env.local.example` — copy to `.env.local` and fill in `OPENAI_API_KEY`.
  Swytchcode provider auth (Drive/Notion/Gmail) is handled separately via
  `swytchcode auth connect <provider>`, not env vars.

### Swytchcode providers

Three provider bundles have been fetched locally (`swytchcode get`) but no methods
are enabled in `tooling.json` yet — that happens once specific methods are chosen:

| Toolkit | Canonical slug | Fetch command used |
|---|---|---|
| Google Drive | `drive` | `swytchcode get "Google Drive"` |
| Notion | `notion` | `swytchcode get notion` |
| Gmail | `gmail` | `swytchcode get gmail` |

Run `swytchcode list methods <toolkit>` to see all available methods per toolkit,
and `swytchcode add method <canonical_id>` to enable the ones you need.

## Getting Started

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the result.
