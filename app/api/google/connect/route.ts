import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { authUrl, googleConfigured, originOf } from "@/lib/google";

export const dynamic = "force-dynamic";

/** "Connect Google Calendar": off to Google's consent screen. */
export async function GET(req: Request) {
  const origin = originOf(req);
  if (!googleConfigured()) return NextResponse.redirect(`${origin}/?google=missing-keys`);
  const state = crypto.randomBytes(16).toString("hex");
  const res = NextResponse.redirect(authUrl(origin, state));
  res.cookies.set("g_state", state, { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}
