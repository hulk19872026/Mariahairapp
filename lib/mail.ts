import { Resend } from "resend";
import { textToHtml } from "./templates";

/**
 * Plain transactional email to the stylist herself (password resets and the
 * like). Client messages go through senders.ts, which also logs them.
 */
export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (process.env.DRY_RUN === "true") {
    console.log(`[dry-run] mail to ${opts.to}: ${opts.subject}\n${opts.text}`);
    return { ok: true };
  }
  if (!mailConfigured())
    return { ok: false, error: "Email is not set up (RESEND_API_KEY / MAIL_FROM)." };
  try {
    const client = new Resend(process.env.RESEND_API_KEY);
    const { error } = await client.emails.send({
      from: process.env.MAIL_FROM!,
      to: [opts.to],
      replyTo: process.env.MAIL_REPLY_TO || undefined,
      subject: opts.subject,
      text: opts.text,
      html: textToHtml(opts.text),
    });
    if (error) return { ok: false, error: error.message || String(error) };
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
