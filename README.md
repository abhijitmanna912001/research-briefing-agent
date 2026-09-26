# Cross-Source Research Briefing Agent

Ask a question and get a cited briefing synthesized from your Google Drive and Notion, with a live trace of every tool call.

It searches both sources, reads the best matches, and writes a sourced answer. On request it can also save the result as a Notion page or a Gmail draft. Built with the Vercel AI SDK, with tool execution delegated to [Swytchcode](https://swytchcode.com).

## Deployment note

This agent's tool execution goes through the Swytchcode CLI (`swytchcode`),
which the runtime invokes as a subprocess. Vercel's serverless functions
don't have this binary available, so the deployed Vercel URL will fail
at the tool-loading step. The working demo runs locally
(`npm run dev`), where the CLI is installed and provider credentials
are connected via `swytchcode auth connect`.

## Getting started

```bash
cp .env.local.example .env.local   # set OPENAI_API_KEY
swytchcode auth connect google-drive
swytchcode auth connect notion
swytchcode auth connect gmail
npm run dev                        # http://localhost:3000
```

Leave `SWYTCHCODE_BIN` unset: pointing it at the npm-installed wrapper makes the CLI spawn itself in a loop.

## How it works

See [docs/architecture.md](docs/architecture.md) for the diagram and the design decisions behind the tool-wrapper layer.
