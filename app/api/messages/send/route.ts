import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/automation";
import { send, toE164 } from "@/lib/senders";
import { ApiError, handle, ok, readJson, requireApiSession } from "@/lib/api";

export const dynamic = "force-dynamic";

/** A message the stylist writes and sends from the app, right now. */
export const POST = handle(async (req: Request) => {
  await requireApiSession();
  const body = await readJson(req);
  const customerId = String(body.customerId ?? "");
  const channel = body.channel === "email" ? "email" : body.channel === "sms" ? "sms" : null;
  const text = String(body.body ?? "").trim();
  if (!channel) throw new ApiError("Pick email or text.");
  if (!text) throw new ApiError("Write a message first.");

  const c = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!c) throw new ApiError("That client no longer exists.", 404);

  if (channel === "email") {
    if (!c.email) throw new ApiError("This client has no email address.");
    if (c.emailOptOut) throw new ApiError("This client has unsubscribed from email.");
  } else {
    if (!c.phone || !toE164(c.phone)) throw new ApiError("This client has no usable phone number.");
    if (c.smsOptOut) throw new ApiError("This client replied STOP — no more texts.");
    if (!c.smsConsent) throw new ApiError("Record the client's consent to texts first.");
  }

  const apptId = body.apptId ? String(body.apptId) : null;
  const appointmentId =
    apptId && (await prisma.appointment.findUnique({ where: { id: apptId } })) ? apptId : null;
  const st = await getSettings();

  const r = await send({
    customerId,
    appointmentId,
    kind: String(body.kind ?? "manual") || "manual",
    channel,
    to: channel === "email" ? c.email : c.phone,
    subject: channel === "email" ? String(body.subject ?? "").trim() : "",
    body: text,
    dedupeKey: `manual:${crypto.randomUUID()}`,
    auto: false,
    footer: [st.bizName, st.address, st.phone].filter(Boolean).join(" · "),
  });
  if (!r.ok) throw new ApiError(r.error || "The message could not be sent.", 502);
  return ok({ ok: true, id: r.id ?? "" });
});
