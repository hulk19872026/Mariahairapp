import { prisma } from "@/lib/prisma";
import { ApiError, handle, ok, readJson, requireApiSession } from "@/lib/api";
import { couponOut } from "@/lib/records";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Redeem a coupon against an appointment (`apptId`), or release it again
 * (`apptId: null`) if the payment is corrected.
 */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  await requireApiSession();
  const { id } = await ctx.params;
  const body = await readJson(req);
  const coupon = await prisma.coupon.findUnique({ where: { id } });
  if (!coupon) throw new ApiError("That coupon no longer exists.", 404);

  const apptId = body.apptId ? String(body.apptId) : null;
  if (apptId) {
    const appt = await prisma.appointment.findUnique({ where: { id: apptId } });
    if (!appt) throw new ApiError("That appointment no longer exists.", 404);
    if (appt.customerId !== coupon.customerId) throw new ApiError("That coupon belongs to a different client.");
    if (coupon.appointmentId && coupon.appointmentId !== apptId)
      throw new ApiError("That coupon has already been used on another visit.", 409);
  }
  const updated = await prisma.coupon.update({
    where: { id },
    data: { appointmentId: apptId, redeemedAt: apptId ? coupon.redeemedAt ?? new Date() : null },
  });
  return ok(couponOut(updated));
});
