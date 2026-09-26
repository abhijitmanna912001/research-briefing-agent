// Tool errors reach the UI as free text. Some are short ("drive_file_list failed: [validation] 400 Invalid
// query"), but a failure inside the swytchcode CLI arrives as its raw log: timestamped lines, an echo of the
// request, a JSON error payload (sometimes with another JSON payload nested inside it), a docs URL and a
// reference id. summarizeError pulls out the one line a person needs; the full text stays available behind a
// <details> in the card.

export const SUMMARY_MAX = 120;

// Text after the last `"error":"..."` in a JSON payload embedded in the log.
const JSON_ERROR = /"error"\s*:\s*"((?:[^"\\]|\\.)*)"/g;

function unescapeJsonString(s: string): string {
  try {
    return JSON.parse(`"${s}"`) as string;
  } catch {
    return s;
  }
}

// "refresh credential for X: backend returned status 500: {"error":"...","details":"..."}" -> keep the
// readable head and append the nested payload's own reason, instead of showing raw JSON.
function flattenNestedJson(message: string): string {
  const brace = message.indexOf("{");
  if (brace < 1) return message;
  try {
    const inner = JSON.parse(message.slice(brace)) as Record<string, unknown>;
    const reason = [inner.details, inner.error, inner.message].find((v): v is string => typeof v === "string");
    const head = message.slice(0, brace).replace(/[:\s]+$/, "");
    return reason ? `${head} - ${reason}` : head;
  } catch {
    return message; // the "{" was ordinary text, not a JSON payload: leave it alone
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

const clean = (s: string) => s.replaceAll("﻿", "").replace(/\s+/g, " ").trim();

export function summarizeError(raw: string): string {
  const text = raw.trim();

  // 1. A JSON payload with an "error" field: use the last one (the CLI prints the final payload last).
  const jsonErrors = [...text.matchAll(JSON_ERROR)];
  if (jsonErrors.length > 0) {
    const last = jsonErrors[jsonErrors.length - 1][1];
    return truncate(clean(flattenNestedJson(unescapeJsonString(last))), SUMMARY_MAX);
  }

  // 2. `error=...` key/value logging: the text after the last `error=`.
  const kv = [...text.matchAll(/\berror=([^\n]+)/g)];
  if (kv.length > 0) return truncate(clean(kv[kv.length - 1][1]), SUMMARY_MAX);

  // 3. Anything else (multi-line log with no JSON or error=): strip the "<timestamp> [component]" prefixes, then
  //    prefer the last line that reads like a failure, else the last line, then truncate.
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\d{4}[/-]\d{2}[/-]\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?\s*(\[[^\]]*\]\s*)?/, "").trim())
    .filter(Boolean);
  const failure = /\b(fail(ed|ure)?|error|denied|refused|time(d)? ?out|no such host|invalid|missing|unauthori[sz]ed|forbidden|not found|expired)\b/i;
  const pick = [...lines].reverse().find((l) => failure.test(l)) ?? lines[lines.length - 1] ?? "";
  return truncate(clean(pick), SUMMARY_MAX);
}

// Show the raw-text disclosure only when the summary leaves something out.
export function hasMoreDetail(raw: string, summary: string): boolean {
  return clean(raw) !== summary;
}
