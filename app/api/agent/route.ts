import type { NextRequest } from "next/server";

// Agent loop goes here tomorrow: parse the incoming briefing request,
// call the model via the Vercel AI SDK, and delegate any tool calls
// (Drive/Notion/Gmail methods or workflows) to Swytchcode's exec().
export async function POST(_req: NextRequest) {
  return Response.json({ error: "not implemented" }, { status: 501 });
}
