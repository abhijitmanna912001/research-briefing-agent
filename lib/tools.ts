import { jsonSchema, tool } from "ai";
import type { ToolSet } from "ai";
import { Swytchcode } from "@swytchcode/runtime";
import { VercelProvider } from "@swytchcode/runtime/providers/vercel";

// Toolkit names are matched against the integration strings in tooling.json
// ("Google Drive.drive@v3", "Notion.notion@...", "Gmail.gmail@v1"), so Drive is "drive", not
// "google-drive" (which silently matches nothing).
// The swytchcode CLI resolves its credential cache (SQLite) and config at
// os.homedir()/.swytchcode. Vercel functions don't give that a writable HOME (and the
// dashboard refuses to let you set HOME as a project env var - it's a reserved name), so
// point it at /tmp, which is always writable in the function. This only has to be set
// before the first exec() call, which happens inside getAgentTools() below, and it flows
// through to the spawned CLI process because the runtime spreads process.env into the
// child's env. Locally this does nothing harmful either - /tmp exists everywhere Node runs.

if (process.env.VERCEL) {
  process.env.HOME = "/tmp";
}

const TOOLKITS = ["drive", "notion", "gmail"];

const NOTION_MARKDOWN_VERSION = "2026-03-11";

const swx = new Swytchcode(new VercelProvider());

// notion.markdown.get declares Notion-Version as a *required header*, but the CLI validator only
// accepts it when it is present in the input params AND in headers. The runtime's flat-args path
// puts non-path/query fields in `body`, so the generated tool can never satisfy the validator.
// Wrap it: the model only supplies page_id; we build the params+headers shape ourselves.
function patchNotionMarkdown(tools: ToolSet): ToolSet {
  const base = tools.notion_markdown_get;
  if (!base) return tools;
  const cid = swx.tools.nameToId("notion_markdown_get");
  return {
    ...tools,
    notion_markdown_get: tool({
      description: base.description,
      inputSchema: jsonSchema<{ page_id: string; include_transcript?: boolean }>({
        type: "object",
        properties: {
          page_id: { type: "string", description: "Notion page ID (UUID), from a notion_search_create result" },
          include_transcript: { type: "boolean" },
        },
        required: ["page_id"],
      }),
      execute: ({ page_id, include_transcript }) =>
        swx.tools.execute(cid, {
          params: {
            page_id,
            ...(include_transcript !== undefined && { include_transcript }),
            "Notion-Version": NOTION_MARKDOWN_VERSION,
          },
          headers: { "Notion-Version": NOTION_MARKDOWN_VERSION },
        }),
    }),
  };
}

const NOTION_DEFAULT_VERSION = "2025-09-03";

// Pages this agent creates are tagged with a title prefix, and search hides anything carrying it.
// Otherwise the agent's own earlier summaries turn up in later searches and get cited as if they were
// independent source documentation, so answers quietly become self-confirming.
export const AGENT_PAGE_PREFIX = "[Agent] ";

function pageTitle(page: unknown): string {
  const props = (page as { properties?: Record<string, { type?: string; title?: { plain_text?: string }[] }> }).properties ?? {};
  const t = Object.values(props).find((p) => p.type === "title");
  return (t?.title ?? []).map((x) => x.plain_text ?? "").join("");
}

// notion.search.create: the generated schema exposes filter/sort/start_cursor/Notion-Version and the
// model fills them with junk (filter.property "title" -> 400, start_cursor "null" -> 400, stale
// Notion-Version 2022-06-28). The model only supplies query and page_size; the filter is locked to
// pages and the version is pinned.
function patchNotionSearch(tools: ToolSet): ToolSet {
  const base = tools.notion_search_create;
  if (!base) return tools;
  const cid = swx.tools.nameToId("notion_search_create");
  return {
    ...tools,
    notion_search_create: tool({
      description: base.description,
      inputSchema: jsonSchema<{ query: string; page_size?: number }>({
        type: "object",
        properties: {
          query: { type: "string", description: "Keywords to match against page titles" },
          page_size: { type: "integer", minimum: 1, maximum: 25, description: "Max results (default 10)" },
        },
        required: ["query"],
      }),
      execute: async ({ query, page_size }) => {
        const result = await swx.tools.execute(cid, {
          "Notion-Version": NOTION_DEFAULT_VERSION,
          body: { query, page_size: page_size ?? 10, filter: { property: "object", value: "page" } },
        });
        const data = (result as { data?: { results?: unknown[] } }).data;
        if (!data || !Array.isArray(data.results)) return result;
        const kept = data.results.filter((p) => !pageTitle(p).startsWith(AGENT_PAGE_PREFIX));
        const hidden = data.results.length - kept.length;
        if (hidden === 0) return result;
        return {
          ...(result as object),
          data: { ...data, results: kept },
          note: `${hidden} page(s) titled "${AGENT_PAGE_PREFIX}..." were hidden: they are this agent's own earlier output, not source documentation, so never cite them as evidence.`,
        };
      },
    }),
  };
}

// notion.page.create: the generated schema types `properties` as a string, `children` as a string
// array and `parent` as a tangle of variant_* objects, so a model cannot build a valid body. The
// model supplies title, content and an optional parent_page_id; the wrapper builds the request.
// With no parent the page is created at the workspace root, which this integration allows.
const NOTION_TEXT_LIMIT = 2000; // max characters per rich_text item
const NOTION_MAX_BLOCKS = 100; // max children per create request
const NOTION_ID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

type NotionBlock = Record<string, unknown>;

function richText(text: string) {
  const parts: { type: "text"; text: { content: string } }[] = [];
  for (let i = 0; i < text.length; i += NOTION_TEXT_LIMIT) {
    parts.push({ type: "text", text: { content: text.slice(i, i + NOTION_TEXT_LIMIT) } });
  }
  return parts;
}

// Convert light markdown (headings, bullets, numbered lists, paragraphs) to Notion blocks.
export function markdownToNotionBlocks(md: string): NotionBlock[] {
  const blocks: NotionBlock[] = [];
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    let type = "paragraph";
    let text = line.trim();
    if (heading) {
      type = `heading_${Math.min(heading[1].length, 3)}`;
      text = heading[2];
    } else if (bullet) {
      type = "bulleted_list_item";
      text = bullet[1];
    } else if (numbered) {
      type = "numbered_list_item";
      text = numbered[1];
    }
    blocks.push({ object: "block", type, [type]: { rich_text: richText(markdownToPlainText(text)) } });
  }
  return blocks;
}

function taggedTitle(title: string): string {
  const t = title.trim();
  return t.startsWith(AGENT_PAGE_PREFIX) ? t : AGENT_PAGE_PREFIX + t;
}

function patchNotionPageCreate(tools: ToolSet): ToolSet {
  const base = tools.notion_page_create;
  if (!base) return tools;
  const cid = swx.tools.nameToId("notion_page_create");
  return {
    ...tools,
    notion_page_create: tool({
      description:
        "Create a Notion page with a title and text content. Created at the workspace root unless parent_page_id " +
        "is given. Only call when the user explicitly asks to save or write something to Notion.",
      inputSchema: jsonSchema<{ title: string; content?: string; parent_page_id?: string }>({
        type: "object",
        properties: {
          title: { type: "string", description: "Page title" },
          content: {
            type: "string",
            description: "Page body. Light markdown is fine: # headings, - bullets, 1. numbered items, plain paragraphs.",
          },
          parent_page_id: {
            type: "string",
            description: "Optional. UUID of an existing page to create this under (e.g. from notion_search_create). Omit to create at the workspace root.",
          },
        },
        required: ["title"],
      }),
      execute: async ({ title, content, parent_page_id }) => {
        if (parent_page_id && !NOTION_ID_RE.test(parent_page_id.trim())) {
          throw new Error(`notion_page_create failed: parent_page_id must be a Notion page UUID, got "${parent_page_id}"`);
        }
        const blocks = content ? markdownToNotionBlocks(content) : [];
        const truncated = blocks.length > NOTION_MAX_BLOCKS;
        const result = await swx.tools.execute(cid, {
          "Notion-Version": NOTION_DEFAULT_VERSION,
          body: {
            parent: parent_page_id ? { type: "page_id", page_id: parent_page_id.trim() } : { workspace: true },
            properties: { title: { title: richText(taggedTitle(title)) } },
            ...(blocks.length && { children: blocks.slice(0, NOTION_MAX_BLOCKS) }),
          },
        });
        return truncated
          ? { ...(result as object), note: `Content was longer than ${NOTION_MAX_BLOCKS} blocks; the extra blocks were dropped. Tell the user.` }
          : result;
      },
    }),
  };
}

// drive.file.list is wired to the Drive *v2* REST API (GET /drive/v2/files) and the generated
// schema lists ~16 optional params. Verified live against the API:
//   - corpora / corpus (any value) -> 400, so they are never sent
//   - pageSize is silently ignored; the v2 name is maxResults
//   - orderBy needs v2 field names (modifiedDate, createdDate, title), not v3 (modifiedTime, name)
//   - q must use `title contains ...` (v2); `name contains ...` (v3) -> 400 "Invalid query"
const DRIVE_DEFAULT_FIELDS = "items(id,title,mimeType,modifiedDate,alternateLink),nextPageToken";
const DRIVE_ORDER_BY_V3_TO_V2: Record<string, string> = {
  modifiedTime: "modifiedDate",
  createdTime: "createdDate",
  name: "title",
};

// Drive rejects bare words ("AuditFlow architecture") with 400 "Invalid query". If q has no query
// operator, treat it as a full-text search instead of failing.
function normalizeDriveQuery(q: string | undefined): string {
  const t = q?.trim();
  if (!t) return "trashed = false";
  if (/(\bcontains\b|\bhas\b|\bin\b|[=<>]|\bnot\b)/i.test(t)) return t;
  return `fullText contains '${t.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' and trashed = false`;
}

function patchDriveList(tools: ToolSet): ToolSet {
  const base = tools.drive_file_list;
  if (!base) return tools;
  const cid = swx.tools.nameToId("drive_file_list");
  return {
    ...tools,
    drive_file_list: tool({
      description:
        "Search or list Google Drive files. Returns items with id, title, mimeType, modifiedDate. " +
        "Filter with q (Drive v2 query syntax: title contains 'x', fullText contains 'x', mimeType = '...', trashed = false).",
      inputSchema: jsonSchema<{ q?: string; pageSize?: number; orderBy?: string; fields?: string }>({
        type: "object",
        properties: {
          q: {
            type: "string",
            description:
              "Drive v2 query, e.g. \"fullText contains 'roadmap' and trashed = false\" or \"title contains 'Q3'\". Use title, not name.",
          },
          pageSize: { type: "integer", minimum: 1, maximum: 50, description: "Max files to return (default 10)" },
          orderBy: { type: "string", description: "e.g. 'modifiedDate desc', 'title'" },
          fields: { type: "string", description: `Partial-response field mask (default: ${DRIVE_DEFAULT_FIELDS})` },
        },
        required: [],
      }),
      execute: async ({ q, pageSize, orderBy, fields }) => {
        const query = normalizeDriveQuery(q);
        const v2Order = orderBy?.replace(/\b(modifiedTime|createdTime|name)\b/g, (m) => DRIVE_ORDER_BY_V3_TO_V2[m]);
        const result = await swx.tools.execute(cid, {
          params: {
            q: query,
            maxResults: pageSize ?? 10,
            orderBy: v2Order,
            fields: fields || DRIVE_DEFAULT_FIELDS,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
          },
        });
        // Tool output is what the model reads next. An empty list otherwise looks like "nothing exists"
        // and the model stops; tell it plainly that this is a search miss, not a verdict.
        const items = (result as { data?: { items?: unknown[] } }).data?.items ?? [];
        if (items.length === 0) {
          return {
            ...(result as object),
            note:
              `No files matched q=${JSON.stringify(query)}. This does not mean the file does not exist. Retry with different, ` +
              "shorter keywords (one distinctive word, e.g. fullText contains 'Swytchcode') or title contains '...' before concluding nothing is there.",
          };
        }
        return result;
      },
    }),
  };
}

// drive.file.export.get returns the document as plain text, but the CLI's default JSON mode tries to
// parse the body as JSON and fails ("response is not valid JSON: <the document>"), so the tool
// errors even though Google returned the content. Raw mode returns {"body": "<text>"}; in that mode
// an API error also arrives as a JSON string inside body, so detect it here.
const DRIVE_EXPORT_MAX_CHARS = 30_000; // keep one document from swamping the model's context

function patchDriveExport(tools: ToolSet): ToolSet {
  const base = tools.drive_file_export_get;
  if (!base) return tools;
  const cid = swx.tools.nameToId("drive_file_export_get");
  return {
    ...tools,
    drive_file_export_get: tool({
      description:
        "Read the text content of a native Google Doc, Sheet or Slide by file id (from drive_file_list). " +
        "Does not work for PDFs, images, Office files or other uploaded binaries.",
      inputSchema: jsonSchema<{ fileId: string; mimeType?: "text/plain" | "text/csv" | "text/html" }>({
        type: "object",
        properties: {
          fileId: { type: "string", description: "Drive file id from drive_file_list" },
          mimeType: {
            type: "string",
            enum: ["text/plain", "text/csv", "text/html"],
            description: "Export format: text/plain for Docs/Slides (default), text/csv for Sheets",
          },
        },
        required: ["fileId"],
      }),
      execute: async ({ fileId, mimeType }) => {
        const out = await swx.tools.execute(
          cid,
          { params: { fileId, mimeType: mimeType ?? "text/plain" } },
          { raw: true },
        );
        let body: string = typeof out === "string" ? out : JSON.stringify(out);
        try {
          const parsed = JSON.parse(body) as { body?: unknown };
          if (typeof parsed.body === "string") body = parsed.body;
        } catch {
          // not wrapped; use as is
        }
        try {
          const e = (JSON.parse(body) as { error?: { code?: unknown; message?: unknown } }).error;
          if (e && typeof e.message === "string") throw new Error(`drive_file_export_get failed: ${e.code ?? ""} ${e.message}`.replace("  ", " "));
        } catch (err) {
          if (err instanceof Error && err.message.startsWith("drive_file_export_get failed")) throw err;
        }
        const truncated = body.length > DRIVE_EXPORT_MAX_CHARS;
        return { data: { text: truncated ? body.slice(0, DRIVE_EXPORT_MAX_CHARS) : body, truncated, totalChars: body.length } };
      },
    }),
  };
}

// gmail.user.drafts.create needs body.message.raw = a complete RFC 2822 message, base64url-encoded.
// A model can't reliably hand-build that, so it supplies plain to/cc/subject/body and we assemble it.
const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

function cleanHeader(v: string): string {
  return v.replace(/[\r\n]+/g, " ").trim(); // no CR/LF: prevents header injection
}

function addressList(field: string, v: string | string[] | undefined): string | undefined {
  const list = (Array.isArray(v) ? v : (v ?? "").split(/[,;]/)).map(cleanHeader).filter(Boolean);
  if (list.length === 0) return undefined;
  const bad = list.filter((a) => !EMAIL_RE.test(a));
  if (bad.length) throw new Error(`gmail_user_drafts_create failed: invalid ${field} address: ${bad.join(", ")}`);
  return list.join(", ");
}

function encodeHeaderText(v: string): string {
  return /^[\x00-\x7F]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;
}

export function buildRawEmail(m: { to?: string | string[]; cc?: string | string[]; subject: string; body: string }): string {
  const headers = [
    addressList("to", m.to) && `To: ${addressList("to", m.to)}`,
    addressList("cc", m.cc) && `Cc: ${addressList("cc", m.cc)}`,
    `Subject: ${encodeHeaderText(cleanHeader(m.subject))}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ].filter(Boolean);
  const bodyB64 = Buffer.from(m.body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${bodyB64}`, "utf8").toString("base64url");
}

// Models write markdown even when told not to; Gmail would show the symbols literally.
export function markdownToPlainText(md: string): string {
  return md
    .replace(/^\s{0,3}#{1,6}\s+(.*)$/gm, "$1") // headings
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, "$1$2") // bold
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, "$1$2") // italics (leave "* " bullets alone)
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/^(\s*)[*+]\s+/gm, "$1- ") // bullets -> "-"
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, "$1 ($2)"); // links
}

function patchGmailDraft(tools: ToolSet): ToolSet {
  const base = tools.gmail_user_drafts_create;
  if (!base) return tools;
  const cid = swx.tools.nameToId("gmail_user_drafts_create");
  return {
    ...tools,
    gmail_user_drafts_create: tool({
      description:
        "Create a Gmail draft (saved to Drafts, never sent). Supply plain text fields; the message is assembled for you. " +
        "Leave 'to' out if the user did not give a recipient; do not invent addresses.",
      inputSchema: jsonSchema<{ to?: string | string[]; cc?: string | string[]; subject: string; body: string }>({
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address(es), comma-separated. Omit if unknown." },
          cc: { type: "string", description: "Cc email address(es), comma-separated. Optional." },
          subject: { type: "string" },
          body: { type: "string", description: "Plain-text email body" },
        },
        required: ["subject", "body"],
      }),
      execute: async (m) => {
        const raw = buildRawEmail({ ...m, body: markdownToPlainText(m.body) });
        const result = await swx.tools.execute(cid, { params: { userId: "me" }, body: { message: { raw } } });
        const hasTo = Boolean(addressList("to", m.to));
        // Tool output is what the model reads next, so put the facts it must relay right in it.
        return hasTo ? result : { ...(result as object), note: "Draft saved in Gmail Drafts with NO recipient (To is empty). Tell the user." };
      },
    }),
  };
}

// The CLI reports upstream API failures (HTTP 4xx/5xx from Google/Notion) as a *successful* exec:
// Drive/Gmail -> { data: { error: { code, message } }, error_category }, Notion ->
// { data: { object: "error", status, code, message }, error_category }. Turn those into thrown
// errors so the AI SDK emits a tool-error (shown as a failure in the UI, and the model sees a real
// error) instead of treating an error body as data. The request echo (URL etc.) is left out.
function apiErrorMessage(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const r = result as { data?: unknown; error_category?: unknown };
  const d = (r.data ?? {}) as { error?: unknown; object?: unknown; code?: unknown; status?: unknown; message?: unknown };
  let detail: string | undefined;
  if (d.error) {
    const e = d.error as { code?: unknown; status?: unknown; message?: unknown };
    detail = typeof d.error === "string" ? d.error : `${e.code ?? e.status ?? ""} ${e.message ?? JSON.stringify(d.error)}`.trim();
  } else if (d.object === "error") {
    detail = `${d.status ?? ""} ${d.code ?? ""}: ${d.message ?? ""}`.trim();
  } else if (r.error_category) {
    detail = "request failed";
  }
  if (detail === undefined) return undefined;
  return r.error_category ? `[${String(r.error_category)}] ${detail}` : detail;
}

function throwOnApiError(tools: ToolSet): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, t]) => {
      const run = t.execute as (...a: unknown[]) => unknown;
      return [
        name,
        {
          ...t,
          execute: async (...args: unknown[]) => {
            const result = await run(...args);
            const message = apiErrorMessage(result);
            if (message) throw new Error(`${name} failed: ${message}`);
            return result;
          },
        },
      ];
    }),
  ) as ToolSet;
}

// Loading tools spawns the swytchcode CLI (1 list + 1 info per tool), so do it once per process.
let toolsPromise: Promise<ToolSet> | undefined;
export function getAgentTools(): Promise<ToolSet> {
  toolsPromise ??= (async () => {
    // VercelProvider returns an object keyed by tool name (the typings say any[]).
    let tools = (await swx.tools.get({ toolkits: TOOLKITS })) as unknown as ToolSet;
    tools = patchNotionMarkdown(tools);
    tools = patchNotionSearch(tools);
    tools = patchNotionPageCreate(tools);
    tools = patchDriveList(tools);
    tools = patchDriveExport(tools);
    tools = patchGmailDraft(tools);
    return throwOnApiError(tools);
  })().catch((err) => {
    toolsPromise = undefined; // don't cache a failure
    throw err;
  });
  return toolsPromise;
}

