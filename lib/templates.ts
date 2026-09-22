/**
 * Message wording. Everything in {braces} is replaced before sending.
 * The stylist can overwrite any of these from Settings; whatever she saves
 * lands in Settings.templates and wins over the defaults below.
 */

export const DEFAULT_TEMPLATES: Record<string, string> = {
  confirm_sms:
    "Hi {first}! Your appointment with {stylist} is confirmed for {dateLong} at {time}. Service: {services}. See you soon!",
  night_sms:
    "Hi {first}, see you tomorrow at {time} for {services}. Reply here if anything's changed. — {stylist}",
  dayof_sms:
    "Hi {first}, a reminder about your appointment with {stylist} today at {time}. See you shortly!",
  reschedule_sms:
    "Hi {first}, your appointment has been moved to {dateLong} at {time}. Service: {services}. Let me know if that doesn't work!",
  cancel_sms:
    "Hi {first}, your appointment on {dateLong} at {time} has been cancelled. Text me any time to rebook.",
  rebook_sms:
    "Hi {first}! It's been {since} since your last visit. I'd love to get you back in the chair — text me a day that works. — {stylist}",

  confirm_email_subject: "Your appointment is confirmed",
  confirm_email:
    "Hi {first},\n\nYour appointment with {stylist} is confirmed.\n\nDate: {dateFull}\nTime: {time}\nService: {services}\nDuration: {duration}\nTotal: {price}\nLocation: {address}\n\nSee you soon!\n{business}\n{phone}",

  night_email_subject: "See you tomorrow at {time}",
  night_email:
    "Hi {first},\n\nJust a note before tomorrow.\n\nDate: {dateFull}\nTime: {time}\nService: {services}\nLocation: {address}\n\nIf anything's changed, reply to this email or call {phone} and I'll move you.\n\nSee you then!\n{stylist}\n{business}",

  dayof_email_subject: "Your appointment is today at {time}",
  dayof_email:
    "Hi {first},\n\nA quick reminder that you're booked in today.\n\nTime: {time}\nService: {services}\nLocation: {address}\n\n{business}\n{phone}",

  reschedule_email_subject: "Your appointment has moved",
  reschedule_email:
    "Hi {first},\n\nYour appointment is now on {dateFull} at {time}.\n\nService: {services}\nLocation: {address}\n\nIf that doesn't work, reply to this email or call {phone}.\n\n{business}",

  cancel_email_subject: "Your appointment has been cancelled",
  cancel_email:
    "Hi {first},\n\nYour appointment on {dateFull} at {time} has been cancelled.\n\nTo rebook, just reply to this email or call {phone}.\n\n{business}",

  // No emoji in the text: one emoji switches the whole message to a slower
  // encoding and roughly doubles what Twilio charges for it.
  birthday_sms:
    "Happy birthday, {first}! Hope it's a wonderful one. {couponShort} - {stylist}",
  birthday_email_subject: "Happy birthday, {first}!",
  birthday_email:
    "Hi {first},\n\nHappy birthday from everyone at {business}! 🎉 I hope the year ahead is a great one.\n\n{couponLine}\n\nSee you soon,\n{stylist}",

  rebook_email_subject: "We'd love to see you again",
  rebook_email:
    "Hi {first},\n\nIt's been {since} since your last visit. I'd love to get you back in the chair — reply with a day that works and I'll hold a spot.\n\n{stylist}\n{business}\n{phone}",
};

export function template(
  stored: Record<string, unknown> | null | undefined,
  key: string
): string {
  const v = stored && typeof stored[key] === "string" ? (stored[key] as string) : "";
  return v.trim() ? v : DEFAULT_TEMPLATES[key] ?? "";
}

export function fill(tpl: string, vars: Record<string, string>): string {
  return String(tpl ?? "").replace(/\{(\w+)\}/g, (m, k) =>
    vars[k] != null ? vars[k] : m
  );
}

/** Plain text to a readable HTML email — no framework, no tracking pixels. */
export function textToHtml(text: string, footer?: string): string {
  const esc = (s: string) =>
    s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
  const paras = esc(text)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<!doctype html><html><body style="margin:0;background:#fbf7f6">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;font:16px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#241a28">
${paras}
${footer ? `<hr style="border:none;border-top:1px solid #e2d4da;margin:28px 0 14px"><p style="margin:0;font-size:13px;color:#7b6c77">${esc(footer)}</p>` : ""}
</div></body></html>`;
}
