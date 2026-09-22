import { fromZonedTime } from "date-fns-tz";
import { prisma } from "./prisma";
import { fill, template } from "./templates";
import { send, toE164 } from "./senders";
import type { Appointment, Customer, Prisma, Service, Settings } from "@prisma/client";

/* -------------------------------------------------------------------------
   Settings
   ------------------------------------------------------------------------- */

export async function getSettings(): Promise<Settings> {
  const existing = await prisma.settings.findUnique({ where: { id: "business" } });
  if (existing) return existing;
  const hours: Record<string, Prisma.InputJsonObject> = {};
  for (let d = 0; d < 7; d++)
    hours[d] = { open: d >= 1 && d <= 6, start: 540, end: 1080, breakOn: false, breakStart: 780, breakEnd: 840 };
  return prisma.settings.create({ data: { id: "business", hours } });
}

/* -------------------------------------------------------------------------
   Time. Everything the stylist sees is salon-local; everything stored as an
   instant is UTC. `at()` is the only bridge between the two.
   ------------------------------------------------------------------------- */

const pad = (n: number) => String(n).padStart(2, "0");

/** The instant a given local date + minutes-past-midnight occurs, in the salon's zone. */
export function at(dateISO: string, minutes: number, tz: string): Date {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return fromZonedTime(`${dateISO}T${pad(h)}:${pad(m)}:00`, tz);
}

/** Today's calendar date in the salon's zone, as YYYY-MM-DD. */
export function localDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function addDays(dateISO: string, n: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export function fmtTime(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const ap = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${mm ? ":" + pad(mm) : ""}${ap}`;
}

const MON = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function parts(dateISO: string) {
  const [y, m, d] = dateISO.split("-").map(Number);
  return { y, m: m - 1, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}
export function fmtDate(dateISO: string, style: "short" | "long" | "full" = "short") {
  const p = parts(dateISO);
  if (style === "long") return `${DOW[p.dow]}, ${MON[p.m]} ${p.d}`;
  if (style === "full") return `${DOW[p.dow]}, ${MON[p.m]} ${p.d}, ${p.y}`;
  return `${MON[p.m].slice(0, 3)} ${p.d}`;
}
function daysBetween(a: string, b: string) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}
function sinceText(days: number) {
  if (days < 21) return `${days} day${days === 1 ? "" : "s"}`;
  const w = Math.round(days / 7);
  if (w < 9) return `${w} weeks`;
  return `${Math.round(days / 30.4)} months`;
}

/* -------------------------------------------------------------------------
   Appointment maths
   ------------------------------------------------------------------------- */

export function duration(a: Appointment, services: Service[]): number {
  if (a.duration) return a.duration;
  const sum = a.serviceIds
    .map((id) => services.find((s) => s.id === id))
    .reduce((t, s) => t + (s?.duration ?? 0), 0);
  return sum || 60;
}
export function serviceNames(a: Appointment, services: Service[]): string {
  const names = a.serviceIds
    .map((id) => services.find((s) => s.id === id)?.name)
    .filter(Boolean) as string[];
  return names.length ? names.join(", ") : "Appointment";
}
export function servicePrice(a: Appointment, services: Service[]): number {
  if (a.priceOverride != null) return Number(a.priceOverride);
  return a.serviceIds
    .map((id) => services.find((s) => s.id === id))
    .reduce((t, s) => t + Number(s?.price ?? 0), 0);
}

/* -------------------------------------------------------------------------
   Variables available inside every template
   ------------------------------------------------------------------------- */

export function vars(
  st: Settings,
  c: Customer,
  a: Appointment | null,
  services: Service[],
  extra: Record<string, string> = {}
): Record<string, string> {
  const money = (n: number) =>
    `${st.currency}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  return {
    first: c.first || `${c.first} ${c.last}`.trim() || "there",
    name: `${c.first} ${c.last}`.trim() || "there",
    stylist: st.stylist || st.bizName || "your stylist",
    business: st.bizName || "",
    phone: st.phone || "",
    address: st.address || "",
    website: st.website || "",
    date: a ? fmtDate(a.date) : "",
    dateLong: a ? fmtDate(a.date, "long") : "",
    dateFull: a ? fmtDate(a.date, "full") : "",
    time: a ? fmtTime(a.start) : "",
    services: a ? serviceNames(a, services) : "",
    duration: a ? `${duration(a, services)} min` : "",
    price: a ? money(servicePrice(a, services)) : "",
    since: "a while",
    when: "",
    ...extra,
  };
}

/* -------------------------------------------------------------------------
   Dispatch — build one message and hand it to the sender
   ------------------------------------------------------------------------- */

type Chan = "email" | "sms";

async function dispatch(opts: {
  st: Settings;
  c: Customer;
  a: Appointment | null;
  services: Service[];
  kind: string;
  channel: Chan;
  tplKey: string;
  dedupeKey: string;
  extraVars?: Record<string, string>;
  auto?: boolean;
}) {
  const { st, c, a, services, kind, channel, tplKey, dedupeKey } = opts;
  const v = vars(st, c, a, services, opts.extraVars);
  const tpls = (st.templates ?? {}) as Record<string, unknown>;

  if (channel === "email") {
    if (!c.email || c.emailOptOut) return { ok: false, status: "skipped" as const };
    const body = tidy(fill(template(tpls, `${tplKey}_email`), v));
    const subject = fill(template(tpls, `${tplKey}_email_subject`), v);
    return send({
      customerId: c.id,
      appointmentId: a?.id ?? null,
      kind,
      channel,
      to: c.email,
      subject,
      body,
      dedupeKey,
      auto: opts.auto ?? true,
      footer: [st.bizName, st.address, st.phone].filter(Boolean).join(" · "),
    });
  }

  // no recorded consent, no text — whatever else is switched on
  if (!c.phone || c.smsOptOut || !c.smsConsent || !toE164(c.phone))
    return { ok: false, status: "skipped" as const };
  const body = tidy(fill(template(tpls, `${tplKey}_sms`), v));
  return send({
    customerId: c.id,
    appointmentId: a?.id ?? null,
    kind,
    channel,
    to: c.phone,
    body,
    dedupeKey,
    auto: opts.auto ?? true,
  });
}

/** Optional pieces like {couponLine} can come out empty; don't leave the gaps. */
function tidy(s: string): string {
  return s
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ {2,}/g, " ")
    .replace(/ ([.,!-])/g, (m, ch) => (ch === "-" ? m : ch))
    .trim();
}

/* -------------------------------------------------------------------------
   Birthdays
   ------------------------------------------------------------------------- */

/** "1990-03-14" or "--03-14" (no year given) -> {m: 3, d: 14}. */
export function birthdayOf(dob: string): { m: number; d: number } | null {
  const s = String(dob || "").trim();
  const m = s.match(/^(?:\d{4}|-)-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const month = Number(m[1]), day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { m: month, d: day };
}

/** Is it their birthday today? Feb 29 birthdays are celebrated on Feb 28 in other years. */
export function isBirthday(dob: string, todayISO: string): boolean {
  const b = birthdayOf(dob);
  if (!b) return false;
  const [y, m, d] = todayISO.split("-").map(Number);
  if (b.m === m && b.d === d) return true;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return !leap && b.m === 2 && b.d === 29 && m === 2 && d === 28;
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I lookalikes
function couponCode(first: string): string {
  const name =
    (first || "GUEST")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Lucía -> Lucia, Zoë -> Zoe
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 6) || "GUEST";
  let tail = "";
  for (let i = 0; i < 4; i++) tail += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return `BDAY-${name}-${tail}`;
}

export function couponText(type: string, value: number, currency: string): string {
  const v = Number(value);
  const n = Number.isInteger(v) ? String(v) : v.toFixed(2);
  return type === "amount" ? `${currency}${n} off` : `${n}% off`;
}

/**
 * This year's birthday coupon for a client — created the first time it's
 * asked for, returned as-is every time after. The unique index on
 * (customer, kind, year) means two overlapping runs can't mint two codes.
 */
async function birthdayCoupon(st: Settings, c: Customer, today: string) {
  const year = Number(today.slice(0, 4));
  const existing = await prisma.coupon.findUnique({
    where: { customerId_kind_year: { customerId: c.id, kind: "birthday", year } },
  });
  if (existing) return existing;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.coupon.create({
        data: {
          code: couponCode(c.first),
          customerId: c.id,
          kind: "birthday",
          year,
          type: st.couponType,
          value: st.couponValue,
          note: st.couponNote,
          expiresOn: addDays(today, Math.max(1, st.couponDays) - 1),
        },
      });
    } catch (e: any) {
      if (e?.code !== "P2002") throw e;
      // either the code collided (try another) or another run just made it
      const now = await prisma.coupon.findUnique({
        where: { customerId_kind_year: { customerId: c.id, kind: "birthday", year } },
      });
      if (now) return now;
    }
  }
  return null;
}

/** Which channels a given client should get for a given message. */
function channelsFor(c: Customer): Chan[] {
  const out: Chan[] = [];
  if (c.email && !c.emailOptOut) out.push("email");
  if (c.phone && !c.smsOptOut && c.smsConsent) out.push("sms");
  // honour their stated preference when they have both
  if (out.length === 2) {
    if (c.contact === "Email") return ["email"];
    if (c.contact === "Text") return ["sms", "email"];
  }
  return out;
}

/* -------------------------------------------------------------------------
   The scheduler. Called every hour by /api/cron. Idempotent: running it
   twice in the same hour sends nothing twice.
   ------------------------------------------------------------------------- */

export type RunSummary = {
  sent: number;
  failed: number;
  skipped: number;
  detail: Array<{ kind: string; customer: string; channel: string; status: string; error?: string }>;
};

export async function runAutomations(now = new Date()): Promise<RunSummary> {
  const st = await getSettings();
  const tz = st.timezone || "America/New_York";
  const today = localDate(now, tz);

  const services = await prisma.service.findMany();
  const summary: RunSummary = { sent: 0, failed: 0, skipped: 0, detail: [] };

  const record = (
    kind: string,
    c: Customer,
    channel: string,
    r: { ok: boolean; status: string; error?: string }
  ) => {
    if (r.status === "duplicate") return;
    if (r.status === "sent") summary.sent++;
    else if (r.status === "failed") summary.failed++;
    else summary.skipped++;
    summary.detail.push({
      kind,
      customer: `${c.first} ${c.last}`.trim() || c.id,
      channel,
      status: r.status,
      error: r.error,
    });
  };

  /* ---- 1. booking confirmations ---------------------------------------- */
  if (st.sendConfirm) {
    const upcoming = await prisma.appointment.findMany({
      where: { status: { in: ["scheduled", "confirmed"] }, date: { gte: today } },
      include: { customer: true },
    });
    for (const a of upcoming) {
      for (const ch of channelsFor(a.customer)) {
        const r = await dispatch({
          st, c: a.customer, a, services,
          kind: "confirm", channel: ch, tplKey: "confirm",
          dedupeKey: `confirm:${a.id}:${ch}`,
        });
        record("confirm", a.customer, ch, r);
      }
    }
  }

  /* ---- 2. the night-before email --------------------------------------- */
  if (st.sendNight) {
    const tomorrow = addDays(today, 1);
    const due = await prisma.appointment.findMany({
      where: { status: { in: ["scheduled", "confirmed"] }, date: { in: [today, tomorrow] } },
      include: { customer: true },
    });
    for (const a of due) {
      if (!a.customer.autoNightBefore) continue;
      // goes out at nightHour on the evening before the appointment
      const sendAt = at(addDays(a.date, -1), st.nightHour * 60, tz);
      const apptAt = at(a.date, a.start, tz);
      if (now < sendAt || now >= apptAt) continue;
      const r = await dispatch({
        st, c: a.customer, a, services,
        kind: "night", channel: "email", tplKey: "night",
        dedupeKey: `night:${a.id}`,
      });
      record("night", a.customer, "email", r);
    }
  }

  /* ---- 3. the short-notice text on the day ----------------------------- */
  if (st.sendDayOf) {
    const due = await prisma.appointment.findMany({
      where: { status: { in: ["scheduled", "confirmed"] }, date: { in: [today, addDays(today, 1)] } },
      include: { customer: true },
    });
    for (const a of due) {
      const apptAt = at(a.date, a.start, tz);
      const sendAt = new Date(apptAt.getTime() - st.dayOfHours * 3600_000);
      if (now < sendAt || now >= apptAt) continue;
      const r = await dispatch({
        st, c: a.customer, a, services,
        kind: "dayof", channel: "sms", tplKey: "dayof",
        dedupeKey: `dayof:${a.id}`,
      });
      record("dayof", a.customer, "sms", r);
    }
  }

  /* ---- 4. the rebooking email, every N days ---------------------------- */
  if (st.sendRebook) {
    const customers = await prisma.customer.findMany({
      where: { autoRebook: true, email: { not: "" }, emailOptOut: false },
    });
    for (const c of customers) {
      const future = await prisma.appointment.count({
        where: { customerId: c.id, date: { gte: today }, status: { in: ["scheduled", "confirmed"] } },
      });
      if (future > 0) continue; // already coming back

      const last = await prisma.appointment.findFirst({
        where: { customerId: c.id, status: "completed", date: { lte: today } },
        orderBy: [{ date: "desc" }, { start: "desc" }],
      });
      if (!last) continue;

      const lastNudge = await prisma.messageLog.findFirst({
        where: { customerId: c.id, kind: "rebook", status: "sent" },
        orderBy: { createdAt: "desc" },
      });

      const baseMs = Math.max(
        at(last.date, 12 * 60, tz).getTime(),
        lastNudge?.sentAt?.getTime() ?? 0
      );
      const dueAt = baseMs + c.rebookDays * 86400_000;
      if (now.getTime() < dueAt) continue;

      const gap = daysBetween(last.date, today);
      const r = await dispatch({
        st, c, a: null, services,
        kind: "rebook", channel: "email", tplKey: "rebook",
        // one nudge per client per day at most, whatever else happens
        dedupeKey: `rebook:${c.id}:${today}`,
        extraVars: { since: sinceText(gap) },
      });
      record("rebook", c, "email", r);
    }
  }

  /* ---- 5. birthday wishes, with an optional coupon -------------------- */
  if (st.sendBirthday && now >= at(today, st.birthdayHour * 60, tz)) {
    const candidates = await prisma.customer.findMany({
      where: { autoBirthday: true, dob: { not: "" } },
    });
    const year = today.slice(0, 4);
    for (const c of candidates) {
      if (!isBirthday(c.dob, today)) continue;

      let extra: Record<string, string> = { couponLine: "", couponShort: "", coupon: "", code: "", expires: "" };
      if (st.couponOn) {
        const cp = await birthdayCoupon(st, c, today);
        if (cp) {
          const off = couponText(cp.type, Number(cp.value), st.currency);
          const exp = fmtDate(cp.expiresOn, "long");
          extra = {
            coupon: off,
            code: cp.code,
            expires: exp,
            couponLine:
              `As a little birthday gift, here's ${off} your next visit — just mention code ${cp.code} when you book. ` +
              `It's good until ${exp}.` + (cp.note ? ` ${cp.note}` : ""),
            couponShort: `Here's ${off} your next visit - code ${cp.code}, good until ${fmtDate(cp.expiresOn)}.`,
          };
        }
      }

      // birthdays go out on every channel they have — it's a treat, not a reminder
      const chans: Chan[] = [];
      if (c.email && !c.emailOptOut) chans.push("email");
      if (c.phone && !c.smsOptOut && c.smsConsent) chans.push("sms");
      for (const ch of chans) {
        const r = await dispatch({
          st, c, a: null, services,
          kind: "birthday", channel: ch, tplKey: "birthday",
          dedupeKey: `birthday:${c.id}:${year}:${ch}`,
          extraVars: extra,
        });
        record("birthday", c, ch, r);
      }
    }
  }

  await prisma.cronRun.create({
    data: {
      sent: summary.sent,
      failed: summary.failed,
      skipped: summary.skipped,
      detail: summary.detail.slice(0, 100) as any,
    },
  });

  return summary;
}

/* -------------------------------------------------------------------------
   Sent the moment something changes, rather than on the hour
   ------------------------------------------------------------------------- */

/** Fired the moment a booking is made, so the confirmation isn't an hour late. */
export async function notifyNew(appointmentId: string) {
  const st = await getSettings();
  if (!st.sendConfirm) return { sent: 0 };
  const services = await prisma.service.findMany();
  const a = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { customer: true },
  });
  if (!a || !["scheduled", "confirmed"].includes(a.status)) return { sent: 0 };
  let sent = 0;
  for (const ch of channelsFor(a.customer)) {
    const r = await dispatch({
      st, c: a.customer, a, services,
      kind: "confirm", channel: ch, tplKey: "confirm",
      dedupeKey: `confirm:${a.id}:${ch}`,
    });
    if (r.ok) sent++;
  }
  return { sent };
}

export async function notifyChange(
  appointmentId: string,
  kind: "reschedule" | "cancel"
) {
  const st = await getSettings();
  const services = await prisma.service.findMany();
  const a = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { customer: true },
  });
  if (!a) return { sent: 0 };
  let sent = 0;
  for (const ch of channelsFor(a.customer)) {
    const r = await dispatch({
      st, c: a.customer, a, services,
      kind, channel: ch, tplKey: kind,
      dedupeKey: `${kind}:${a.id}:${ch}:${a.date}:${a.start}`,
    });
    if (r.ok) sent++;
  }
  return { sent };
}
