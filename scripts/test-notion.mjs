// Probe how the JS runtime maps tool args onto path/query/header/body for Notion methods.
// Usage: node scripts/test-notion.mjs [page_id]
import { Swytchcode } from "@swytchcode/runtime";
import { VercelProvider } from "@swytchcode/runtime/providers/vercel";

const PAGE_ID = process.argv[2] ?? "3dd7f36e-550d-80c4-9d29-f5570bdaa0d9";
const V_MD = "2026-03-11";
const V_OLD = "2025-09-03";

const swx = new Swytchcode(new VercelProvider());
const tools = await swx.tools.get({ toolkits: ["notion"] });
console.log("tools loaded:", Object.keys(tools).join(", "));
console.log("markdown_get schema props:", Object.keys(tools.notion_markdown_get.inputSchema.jsonSchema.properties));

async function run(label, toolName, args, { dry = false } = {}) {
  const t0 = Date.now();
  // Same call shape the AI SDK uses: execute(input, options). dryRun is forwarded by runtime.exec.
  const tool = tools[toolName];
  try {
    let out;
    if (dry) out = await swx.tools.execute(swx.tools.nameToId(toolName), args, { dryRun: true, _rawInputs: swx.tools.getInputs(swx.tools.nameToId(toolName)) });
    else out = await tool.execute(args, { toolCallId: "t", messages: [] });
    const s = JSON.stringify(out);
    console.log(`\n[${label}] OK ${Date.now() - t0}ms\n  ${s.slice(0, 420)}${s.length > 420 ? "..." : ""}`);
  } catch (e) {
    console.log(`\n[${label}] FAIL ${Date.now() - t0}ms\n  ${String(e.message).replace(/\s+/g, " ").slice(0, 420)}`);
  }
}

console.log("\n===== notion_markdown_get =====");
await run("A dry-run: {page_id, Notion-Version}  (what the model sends today)", "notion_markdown_get", { page_id: PAGE_ID, "Notion-Version": V_MD }, { dry: true });
await run("A live:    {page_id, Notion-Version}", "notion_markdown_get", { page_id: PAGE_ID, "Notion-Version": V_MD });
await run("B live:    {page_id} only (rely on schema default)", "notion_markdown_get", { page_id: PAGE_ID });
await run("C live:    {params:{page_id}, headers:{Notion-Version}}", "notion_markdown_get", { params: { page_id: PAGE_ID }, headers: { "Notion-Version": V_MD } });
await run("D live:    {params:{page_id,Notion-Version}, headers:{...}}", "notion_markdown_get", { params: { page_id: PAGE_ID, "Notion-Version": V_MD }, headers: { "Notion-Version": V_MD } });

console.log("\n===== notion_search_create =====");
await run("A dry-run: {body:{query}, Notion-Version}", "notion_search_create", { "Notion-Version": V_OLD, body: { query: "a", page_size: 1 } }, { dry: true });
await run("A live:    {body:{query}, Notion-Version}", "notion_search_create", { "Notion-Version": V_OLD, body: { query: "a", page_size: 1 } });
await run("B live:    {body:{query}} only", "notion_search_create", { body: { query: "a", page_size: 1 } });
await run("C live:    {body, headers:{Notion-Version}}", "notion_search_create", { body: { query: "a", page_size: 1 }, headers: { "Notion-Version": V_OLD } });

console.log("\n===== notion_page_create (dry-run only: no page is created) =====");
const parent = { type: "page_id", page_id: PAGE_ID };
await run("A dry-run: {Notion-Version, body}", "notion_page_create", { "Notion-Version": V_OLD, body: { parent, properties: { title: { title: [{ text: { content: "test" } }] } } } }, { dry: true });
await run("B dry-run: {body} only", "notion_page_create", { body: { parent, properties: { title: { title: [{ text: { content: "test" } }] } } } }, { dry: true });

console.log("\n===== AFTER FIX: patched tool from lib/tools.ts (what the route uses) =====");
const { getAgentTools } = await import("../lib/tools.ts");
const agentTools = await getAgentTools();
console.log("markdown_get schema props now:", Object.keys(agentTools.notion_markdown_get.inputSchema.jsonSchema.properties));
async function runPatched(label, args) {
  const t0 = Date.now();
  try {
    const out = await agentTools.notion_markdown_get.execute(args, { toolCallId: "t", messages: [] });
    const s = JSON.stringify(out);
    console.log(`\n[${label}] OK ${Date.now() - t0}ms\n  ${s.slice(0, 300)}...`);
  } catch (e) {
    console.log(`\n[${label}] FAIL ${Date.now() - t0}ms\n  ${String(e.message).replace(/\s+/g, " ").slice(0, 300)}`);
  }
}
await runPatched("patched: {page_id}", { page_id: PAGE_ID });
await runPatched("patched: {page_id, Notion-Version} (extra arg is harmless)", { page_id: PAGE_ID, "Notion-Version": V_MD });

console.log("\n===== AFTER FIX: patched notion_search_create =====");
console.log("search schema props:", Object.keys(agentTools.notion_search_create.inputSchema.jsonSchema.properties));
async function runSearch(label, args) {
  try {
    const out = await agentTools.notion_search_create.execute(args, { toolCallId: "t", messages: [] });
    const shape = Object.keys(out.data).filter((k) => k.startsWith("page_or_"));
    console.log(`[${label}] OK  results=${out.data.results.length}  response-shape-key=${shape}`);
  } catch (e) {
    console.log(`[${label}] FAIL ${String(e.message).replace(/\s+/g, " ").slice(0, 250)}`);
  }
}
await runSearch("model sends stale Notion-Version + junk filter/start_cursor", { query: "AuditFlow", page_size: 3, "Notion-Version": "2022-06-28", filter: { property: "title", value: "string" }, start_cursor: "null" });
await runSearch("model sends only query", { query: "AuditFlow", page_size: 3 });
