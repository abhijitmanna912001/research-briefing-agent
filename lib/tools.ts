import { jsonSchema, tool } from "ai";
import type { ToolSet } from "ai";
import type { JSONSchema7 } from "json-schema";
import { Swytchcode } from "@swytchcode/runtime";
import { VercelProvider } from "@swytchcode/runtime/providers/vercel";

// Toolkit names are matched against the integration strings in tooling.json
// ("Google Drive.drive@v3", "Notion.notion@...", "Gmail.gmail@v1"), so Drive is "drive", not
// "google-drive" (which silently matches nothing).
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

// notion.search.create / notion.page.create have Notion-Version as an optional header with a
// default, but the generated schema exposes it and the model sometimes sends an older version
// (e.g. 2022-06-28), which changes the response shape. Hide the field from the model and always
// send the default.
//
// For search, also hide body.start_cursor: the model fills it with junk like the string "null"
// (400 "should be a valid uuid"), and this agent never paginates.
function forceNotionVersion(tools: ToolSet, name: string): ToolSet {
  const base = tools[name];
  if (!base) return tools;
  const cid = swx.tools.nameToId(name);
  const rawInputs = swx.tools.getInputs(cid);
  const schema = structuredClone((base.inputSchema as { jsonSchema: JSONSchema7 }).jsonSchema);
  delete schema.properties?.["Notion-Version"];
  schema.required = (schema.required ?? []).filter((k) => k !== "Notion-Version");
  const hideCursor = name === "notion_search_create";
  if (hideCursor) delete (schema.properties?.body as JSONSchema7 | undefined)?.properties?.start_cursor;
  return {
    ...tools,
    [name]: tool({
      description: base.description,
      inputSchema: jsonSchema<Record<string, unknown>>(schema),
      execute: (args) => {
        const body = args.body as Record<string, unknown> | undefined;
        if (hideCursor && body) delete body.start_cursor;
        // Spread first so the forced version overrides anything the model sent.
        return swx.tools.execute(cid, { ...args, "Notion-Version": NOTION_DEFAULT_VERSION }, { _rawInputs: rawInputs });
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
      execute: ({ q, pageSize, orderBy, fields }) => {
        const query = normalizeDriveQuery(q);
        const v2Order = orderBy?.replace(/\b(modifiedTime|createdTime|name)\b/g, (m) => DRIVE_ORDER_BY_V3_TO_V2[m]);
        return swx.tools.execute(cid, {
          params: {
            q: query,
            maxResults: pageSize ?? 10,
            orderBy: v2Order,
            fields: fields || DRIVE_DEFAULT_FIELDS,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
          },
        });
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
    tools = forceNotionVersion(tools, "notion_search_create");
    tools = forceNotionVersion(tools, "notion_page_create");
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
