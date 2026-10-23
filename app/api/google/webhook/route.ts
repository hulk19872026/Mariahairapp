import { pull, webhookIsOurs } from "@/lib/google";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Google calls this the moment the connected calendar changes. The call
 * carries no details, only which channel it's for; the pull reads the rest.
 */
export async function POST(req: Request) {
  const h = req.headers;
  if (!(await webhookIsOurs(h.get("x-goog-channel-id") || "", h.get("x-goog-channel-token") || ""))) {
    return new Response(null, { status: 404 }); // a channel we no longer use: Google stops calling
  }
  if (h.get("x-goog-resource-state") !== "sync") {
    await pull().catch((e) => console.error("google webhook pull:", e));
  }
  return new Response(null, { status: 200 });
}
