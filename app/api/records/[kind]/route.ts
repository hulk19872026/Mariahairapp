import { ApiError, handle, ok, readJson, requireApiSession } from "@/lib/api";
import { isKind, upsertRecord } from "@/lib/records";
import { pushAppointment } from "@/lib/google";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ kind: string }> };

/** Insert or replace one record. The app screen sends the whole object. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  await requireApiSession();
  const { kind } = await ctx.params;
  if (!isKind(kind)) throw new ApiError(`Unknown record type "${kind}".`, 404);
  const body = await readJson(req);
  const saved = await upsertRecord(kind, body);
  // keep the Google Calendar event in step (does nothing when not connected)
  if (kind === "appts") await pushAppointment(String(saved.id));
  return ok(saved);
});
