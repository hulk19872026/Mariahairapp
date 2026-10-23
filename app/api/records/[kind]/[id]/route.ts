import { ApiError, handle, noContent, requireApiSession } from "@/lib/api";
import { deleteRecord, isKind } from "@/lib/records";
import { removeEvent } from "@/lib/google";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ kind: string; id: string }> };

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  await requireApiSession();
  const { kind, id } = await ctx.params;
  if (!isKind(kind)) throw new ApiError(`Unknown record type "${kind}".`, 404);
  // take the matching Google events with it (a client takes all their appointments)
  if (kind === "appts" || kind === "customers") {
    const gone = await prisma.appointment.findMany({
      where: kind === "appts" ? { id } : { customerId: id },
      select: { googleEventId: true },
    });
    for (const a of gone) await removeEvent(a.googleEventId);
  }
  await deleteRecord(kind, id);
  return noContent();
});
