import { Resend } from "resend";
import twilio from "twilio";
import { prisma } from "./prisma";
import { textToHtml } from "./templates";

/* -------------------------------------------------------------------------
   Providers. Keys are read from the environment on the server only — they
   are never sent to the browser and never appear in an API response.
   ------------------------------------------------------------------------- */

const DRY_RUN = process.env.DRY_RUN === "true";

let resendClient: Resend | null = null;
function resend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!resendClient) resendClient = new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

let twilioClient: ReturnType<typeof twilio> | null = null;
function tw() {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return null;
  if (!twilioClient) twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  return twilioClient;
}

export function integrationStatus() {
  return {
    email: Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM),
    sms: Boolean(
      process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        (process.env.TWILIO_FROM || process.env.TWILIO_MESSAGING_SERVICE_SID)
    ),
    dryRun: DRY_RUN,
  };
}

/* -------------------------------------------------------------------------
   Phone numbers. Twilio only accepts E.164 (+15551234567). Anything the
   stylist typed by hand gets normalised; anything that still doesn't look
   like a number is refused rather than silently dropped.
   ------------------------------------------------------------------------- */

export function toE164(raw: string, defaultCountry = "+1"): string | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (s.startsWith("+")) {
    const d = "+" + s.slice(1).replace(/\D/g, "");
    return d.length >= 9 ? d : null;
  }
  const digits = s.replace(/\D/g, "");
  if (digits.length === 10) return `${defaultCountry}${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits.length >= 9 ? `+${digits}` : null;
}

/* -------------------------------------------------------------------------
   One entry point for everything that goes out. It writes the log row first
   with the dedupe key, so two overlapping scheduler runs can never send the
   same reminder twice — the second one loses the unique constraint race and
   stops.
   ------------------------------------------------------------------------- */

export type SendJob = {
  customerId: string;
  appointmentId?: string | null;
  kind: string;
  channel: "email" | "sms";
  to: string;
  subject?: string;
  body: string;
  dedupeKey: string;
  auto?: boolean;
  replyTo?: string;
  footer?: string;
};

export type SendResult = {
  ok: boolean;
  status: "sent" | "failed" | "skipped" | "duplicate";
  error?: string;
  id?: string;
};

export async function send(job: SendJob): Promise<SendResult> {
  // claim the dedupe key
  let logId: string;
  try {
    const row = await prisma.messageLog.create({
      data: {
        customerId: job.customerId,
        appointmentId: job.appointmentId ?? null,
        kind: job.kind,
        channel: job.channel,
        to: job.to,
        subject: job.subject ?? "",
        body: job.body,
        status: "queued",
        auto: job.auto ?? true,
        dedupeKey: job.dedupeKey,
      },
    });
    logId = row.id;
  } catch (e: any) {
    if (e?.code === "P2002") return { ok: false, status: "duplicate" };
    throw e;
  }

  const finish = async (
    status: SendResult["status"],
    providerId = "",
    error = ""
  ): Promise<SendResult> => {
    await prisma.messageLog.update({
      where: { id: logId },
      data: {
        status: status === "duplicate" ? "skipped" : status,
        providerId,
        error: error.slice(0, 2000),
        sentAt: status === "sent" ? new Date() : null,
      },
    });
    return { ok: status === "sent", status, error: error || undefined, id: providerId };
  };

  if (DRY_RUN) return finish("sent", "dry-run");

  try {
    if (job.channel === "email") {
      const client = resend();
      const from = process.env.MAIL_FROM;
      if (!client || !from)
        return finish("skipped", "", "Resend is not configured (RESEND_API_KEY / MAIL_FROM).");

      const { data, error } = await client.emails.send({
        from,
        to: [job.to],
        replyTo: job.replyTo || process.env.MAIL_REPLY_TO || undefined,
        subject: job.subject || "",
        text: job.body,
        html: textToHtml(job.body, job.footer),
      });
      if (error) return finish("failed", "", error.message || String(error));
      return finish("sent", data?.id ?? "");
    }

    const client = tw();
    if (!client) return finish("skipped", "", "Twilio is not configured.");
    const to = toE164(job.to);
    if (!to) return finish("failed", "", `"${job.to}" is not a usable phone number.`);

    const msg = await client.messages.create({
      to,
      body: job.body,
      ...(process.env.TWILIO_MESSAGING_SERVICE_SID
        ? { messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID }
        : { from: process.env.TWILIO_FROM! }),
    });
    return finish("sent", msg.sid);
  } catch (e: any) {
    return finish("failed", "", e?.message || String(e));
  }
}
