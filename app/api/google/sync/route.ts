import { handle, ok, requireApiSession } from "@/lib/api";
import { googleStatus, syncNow } from "@/lib/google";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** "Sync now" in Settings. */
export const POST = handle(async () => {
  await requireApiSession();
  const result = await syncNow();
  return ok({ result, status: await googleStatus() });
});
