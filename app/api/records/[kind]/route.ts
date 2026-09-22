import { ApiError, handle, ok, readJson, requireApiSession } from "@/lib/api";
import { isKind, upsertRecord } from "@/lib/records";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ kind: string }> };

/** Insert or replace one record. The app screen sends the whole object. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  await requireApiSession();
  const { kind } = await ctx.params;
  if (!isKind(kind)) throw new ApiError(`Unknown record type "${kind}".`, 404);
  const body = await readJson(req);
  return ok(await upsertRecord(kind, body));
});
