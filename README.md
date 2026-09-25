This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Cross-Source Research Briefing Agent

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

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
