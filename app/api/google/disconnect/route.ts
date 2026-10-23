import { handle, ok, requireApiSession } from "@/lib/api";
import { disconnect, googleStatus } from "@/lib/google";

export const dynamic = "force-dynamic";

/** Stops syncing. Events already in Google stay there. */
export const POST = handle(async () => {
  await requireApiSession();
  await disconnect();
  return ok(await googleStatus());
});
