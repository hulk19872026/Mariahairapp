import { ApiError, handle, noContent, requireApiSession } from "@/lib/api";
import { deleteRecord, isKind } from "@/lib/records";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ kind: string; id: string }> };

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  await requireApiSession();
  const { kind, id } = await ctx.params;
  if (!isKind(kind)) throw new ApiError(`Unknown record type "${kind}".`, 404);
  await deleteRecord(kind, id);
  return noContent();
});
