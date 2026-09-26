# Cross-Source Research Briefing Agent

Ask a question and get a cited briefing synthesized from your Google Drive and Notion, with a live trace of every tool call.

It searches both sources, reads the best matches, and writes a sourced answer. On request it can also save the result as a Notion page or a Gmail draft. Built with the Vercel AI SDK, with tool execution delegated to [Swytchcode](https://swytchcode.com).

## Deployment note

This agent's tool execution goes through the Swytchcode CLI (`swytchcode`), which the
runtime invokes as a subprocess. The deployed Vercel URL ships and runs that CLI
correctly (`next.config.ts` traces the platform binary and `.swytchcode/` into the
function, and `HOME` is pointed at `/tmp` so the CLI has a writable cache) — but tool
calls there fail with a clean `missing credentials for <provider>` error
(`category: "auth"`). Swytchcode's docs back this up: connected provider credentials are
written only to `~/.swytchcode/credentials.db` on the machine that ran `swytchcode auth
connect`, and Cloud Sync (their own words) "never" syncs `credentials.db` or any
credential payload — see [cli/authentication](https://docs.swytchcode.com/cli/authentication/)
and [guides/managed-authentication](https://docs.swytchcode.com/guides/managed-authentication/).
`SWYTCHCODE_TOKEN`/`SWYTCHCODE_WORKSPACE_UUID` authenticate the CLI to Swytchcode's own
backend, not to the third-party providers. So the working demo runs locally
(`npm run dev`), where the CLI is installed and provider credentials are connected via
`swytchcode auth connect`.

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
