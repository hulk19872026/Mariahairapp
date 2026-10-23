import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { connect, originOf } from "@/lib/google";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Google sends her back here after she allows access. */
export async function GET(req: Request) {
  const origin = originOf(req);
  const url = new URL(req.url);
  const back = (result: string) => {
    const res = NextResponse.redirect(`${origin}/?google=${encodeURIComponent(result)}`);
    res.cookies.delete("g_state");
    return res;
  };
  if (url.searchParams.get("error")) return back("denied");
  const state = (await cookies()).get("g_state")?.value;
  if (!state || state !== url.searchParams.get("state")) return back("expired");
  try {
    await connect(url.searchParams.get("code") || "", origin);
    return back("connected");
  } catch (e) {
    console.error("google connect:", e);
    return back("failed");
  }
}
