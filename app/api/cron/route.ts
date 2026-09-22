import { NextResponse } from "next/server";
import { runAutomations } from "@/lib/automation";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Runs the reminder scheduler. Call it every hour with:
 *   Authorization: Bearer <CRON_SECRET>
 * It is idempotent — running it twice in the same hour sends nothing twice.
 */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  const url = new URL(req.url);
  return token === secret || url.searchParams.get("secret") === secret;
}

async function handle(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const summary = await runAutomations();
    return NextResponse.json({ ok: true, ...summary });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
