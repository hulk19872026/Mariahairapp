import crypto from "node:crypto";
import type { Appointment, Customer, GoogleCalendar, Service } from "@prisma/client";
import { prisma } from "./prisma";
import { addDays, getSettings, localDate } from "./automation";

/**
 * Two-way sync with one Google Calendar.
 *
 * App → Google: every appointment save or delete calls pushAppointment /
 * removeEvent straight away. The event carries the appointment id in a
 * private extended property, so it can always be found again.
 *
 * Google → app: Google calls /api/google/webhook the moment the calendar
 * changes, and the hourly scheduler runs the same pull as a safety net.
 * A pull reads only what changed since the last one (a sync token):
 *   - an appointment's event moved or resized → the appointment follows
 *   - an appointment's event deleted → the appointment is cancelled
 *   - a new timed event whose title starts with a client's full name
 *     ("Kristine Valentin – Haircut") → a new appointment for that client,
 *     with any menu services named in the title or description
 *   - anything else (Work, Doctor, all-day events) is left alone
 * Changes that come from Google never message the client themselves; a new
 * booking gets the usual confirmation from the hourly scheduler.
 *
 * Each appointment remembers the event's `updated` stamp from the last time
 * the two agreed, so the app's own writes echoing back are skipped.
 */

const SCOPE = "https://www.googleapis.com/auth/calendar";
const API = () => process.env.GOOGLE_API_BASE || "https://www.googleapis.com";
const TOKEN_URL = () => process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const AUTH_URL = () => process.env.GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth";
const ROW = "google";

export const googleConfigured = () =>
  Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());

export async function googleRow(): Promise<GoogleCalendar | null> {
  const g = await prisma.googleCalendar.findUnique({ where: { id: ROW } });
  return g && g.refreshToken ? g : null;
}

/** For the Settings screen. */
export async function googleStatus() {
  const g = await googleRow();
  return {
    configured: googleConfigured(),
    connected: Boolean(g),
    email: g?.email ?? "",
    calendarName: g?.calendarName || g?.calendarId || "",
    lastSyncAt: g?.lastSyncAt?.getTime() ?? null,
    lastError: g?.lastError ?? "",
    live: Boolean(g?.channelExpires && g.channelExpires.getTime() > Date.now()),
  };
}

/* ------------------------------------------------------------- oauth -- */

/** The public address of this app, as the browser reached it. */
export function originOf(req: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  const h = req.headers;
  const host = h.get("x-forwarded-host") || h.get("host") || new URL(req.url).host;
  const proto = h.get("x-forwarded-proto") || new URL(req.url).protocol.replace(":", "");
  return `${proto.split(",")[0]}://${host.split(",")[0]}`;
}

export const redirectUri = (origin: string) =>
  process.env.GOOGLE_REDIRECT_URI || `${origin}/api/google/callback`;

export function authUrl(origin: string, state: string): string {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL()}?${q}`;
}

async function tokenCall(params: Record<string, string>) {
  const res = await fetch(TOKEN_URL(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
      client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
      ...params,
    }),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok) throw new Error(`Google sign-in failed: ${j.error_description || j.error || res.status}`);
  return j;
}

/** Finishes "Connect Google Calendar": keeps the tokens and syncs once. */
export async function connect(code: string, origin: string) {
  const t = await tokenCall({ code, grant_type: "authorization_code", redirect_uri: redirectUri(origin) });
  if (!t.refresh_token) throw new Error("Google didn't grant offline access. Remove the app's access in your Google account and connect again.");
  const data = {
    refreshToken: t.refresh_token as string,
    accessToken: t.access_token as string,
    accessExpires: new Date(Date.now() + (Number(t.expires_in) || 3000) * 1000),
    webhookUrl: `${origin}/api/google/webhook`,
    syncToken: "",
    lastError: "",
  };
  await prisma.googleCalendar.upsert({ where: { id: ROW }, create: { id: ROW, ...data }, update: data });
  const primary = await api("GET", "/calendar/v3/users/me/calendarList/primary");
  const prev = await prisma.googleCalendar.findUnique({ where: { id: ROW } });
  const keep = prev?.calendarId && prev.calendarId !== "primary" && prev.email === primary.id;
  if (!keep) {
    // a different account (or the first connect): every event has to be made afresh
    await prisma.appointment.updateMany({ data: { googleEventId: "", googleUpdated: "" } });
  }
  await prisma.googleCalendar.update({
    where: { id: ROW },
    data: {
      email: primary.id,
      ...(keep ? {} : { calendarId: primary.id, calendarName: primary.summaryOverride || primary.summary || primary.id }),
    },
  });
  await syncNow();
}

export async function disconnect() {
  const g = await googleRow();
  if (g) {
    await stopChannel(g).catch(() => {});
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(g.refreshToken)}`, { method: "POST" }).catch(() => {});
  }
  await prisma.googleCalendar.deleteMany({ where: { id: ROW } });
}

async function accessToken(force = false): Promise<string> {
  const g = await googleRow();
  if (!g) throw new Error("Google Calendar isn't connected.");
  if (!force && g.accessToken && g.accessExpires && g.accessExpires.getTime() > Date.now() + 60_000) return g.accessToken;
  const t = await tokenCall({ refresh_token: g.refreshToken, grant_type: "refresh_token" });
  await prisma.googleCalendar.update({
    where: { id: ROW },
    data: { accessToken: t.access_token, accessExpires: new Date(Date.now() + (Number(t.expires_in) || 3000) * 1000) },
  });
  return t.access_token;
}

class GoogleError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function api(method: string, path: string, body?: unknown, retried = false): Promise<any> {
  const res = await fetch(API() + path, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken(retried)}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !retried) return api(method, path, body, true);
  if (res.status === 204) return {};
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new GoogleError(res.status, `Google Calendar: ${j?.error?.message || res.statusText || res.status}`);
  return j;
}

const cal = (g: GoogleCalendar) => `/calendar/v3/calendars/${encodeURIComponent(g.calendarId)}`;

export async function listCalendars() {
  const j = await api("GET", "/calendar/v3/users/me/calendarList?minAccessRole=writer");
  return ((j.items ?? []) as any[]).map((c) => ({ id: c.id as string, name: (c.summaryOverride || c.summary || c.id) as string, primary: !!c.primary }));
}

/** Switches to another calendar: events are made afresh there. */
export async function chooseCalendar(id: string) {
  const g = await googleRow();
  if (!g) throw new Error("Google Calendar isn't connected.");
  const c = (await listCalendars()).find((x) => x.id === id);
  if (!c) throw new Error("That calendar isn't one you can edit.");
  await stopChannel(g).catch(() => {});
  await prisma.googleCalendar.update({
    where: { id: ROW },
    data: { calendarId: c.id, calendarName: c.name, syncToken: "", channelId: "", channelExpires: null },
  });
  await prisma.appointment.updateMany({ data: { googleEventId: "", googleUpdated: "" } });
  await syncNow();
}

/* --------------------------------------------------------- app → google -- */

const pad = (n: number) => String(n).padStart(2, "0");
const localStamp = (date: string, min: number) => {
  const d = Math.floor(min / 1440);
  const m = ((min % 1440) + 1440) % 1440;
  return `${d ? addDays(date, d) : date}T${pad(Math.floor(m / 60))}:${pad(m % 60)}:00`;
};

function lengthOf(a: Appointment, services: Service[]): number {
  if (a.duration) return a.duration;
  const sum = a.serviceIds.reduce((t, id) => t + (services.find((s) => s.id === id)?.duration ?? 0), 0);
  return sum || 60;
}

function eventFor(a: Appointment, c: Customer, services: Service[], tz: string, currency: string) {
  const svcs = a.serviceIds.map((id) => services.find((s) => s.id === id)).filter((s): s is Service => !!s);
  const name = `${c.first} ${c.last}`.trim() || "Client";
  const agreed = (a.servicePrices ?? {}) as Record<string, number>;
  const price = a.priceOverride != null ? Number(a.priceOverride) : svcs.reduce((t, s) => t + Number(agreed[s.id] ?? s.price), 0);
  const status = a.status === "confirmed" ? "Confirmed" : a.status === "completed" ? "Completed" : a.status === "noshow" ? "No-show" : "";
  return {
    summary: `${name}${svcs.length ? " – " + svcs.map((s) => s.name).join(", ") : ""}`,
    description: [
      svcs.length ? `Services: ${svcs.map((s) => s.name).join(", ")}${price ? ` (${currency}${price})` : ""}` : "",
      c.phone ? `Phone: ${c.phone}` : "",
      c.email ? `Email: ${c.email}` : "",
      status ? `Status: ${status}` : "",
      a.notes ? `\n${a.notes}` : "",
      "\nFrom the salon app. Moving or deleting this event changes the appointment too.",
    ].filter(Boolean).join("\n"),
    start: { dateTime: localStamp(a.date, a.start), timeZone: tz },
    end: { dateTime: localStamp(a.date, a.start + lengthOf(a, services)), timeZone: tz },
    extendedProperties: { private: { mhAppt: a.id } },
  };
}

/** Creates, updates or removes the Google event for one appointment. Never throws. */
export async function pushAppointment(id: string): Promise<void> {
  try {
    const g = await googleRow();
    if (!g) return;
    const a = await prisma.appointment.findUnique({ where: { id }, include: { customer: true } });
    if (!a) return;
    if (a.status === "cancelled") {
      if (a.googleEventId) {
        await deleteEvent(g, a.googleEventId);
        await prisma.appointment.update({ where: { id }, data: { googleEventId: "", googleUpdated: "" } });
      }
      return;
    }
    const st = await getSettings();
    const tz = st.timezone || "America/New_York";
    // old history stays out of the calendar unless it's already there
    if (!a.googleEventId && a.date < addDays(localDate(new Date(), tz), -1)) return;
    const services = await prisma.service.findMany();
    const body = eventFor(a, a.customer, services, tz, st.currency || "$");
    let ev: any = null;
    if (a.googleEventId) {
      ev = await api("PATCH", `${cal(g)}/events/${encodeURIComponent(a.googleEventId)}`, body).catch((e) => {
        if (e instanceof GoogleError && (e.status === 404 || e.status === 410)) return null;
        throw e;
      });
      if (ev?.status === "cancelled") ev = null;
    }
    if (!ev) ev = await api("POST", `${cal(g)}/events`, body);
    await prisma.appointment.update({ where: { id }, data: { googleEventId: ev.id, googleUpdated: ev.updated ?? "" } });
    await noteOk();
  } catch (e) {
    await noteError(e);
  }
}

/** Called before an appointment is deleted from the app. Never throws. */
export async function removeEvent(eventId: string): Promise<void> {
  if (!eventId) return;
  try {
    const g = await googleRow();
    if (g) await deleteEvent(g, eventId);
  } catch (e) {
    await noteError(e);
  }
}

async function deleteEvent(g: GoogleCalendar, eventId: string) {
  await api("DELETE", `${cal(g)}/events/${encodeURIComponent(eventId)}`).catch((e) => {
    if (e instanceof GoogleError && (e.status === 404 || e.status === 410)) return;
    throw e;
  });
}

/* --------------------------------------------------------- google → app -- */

const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
const svcKey = (n: string) => norm(n.replace(/\([^)]*\)/g, "")).replace(/s$/, "");

/** An RFC 3339 instant → the salon's local date and minutes past midnight. */
function toLocal(iso: string, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(iso)).map((x) => [x.type, x.value])
  );
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}

let pulling: Promise<string> | null = null;

/** Applies everything that changed in Google since the last pull. */
export function pull(): Promise<string> {
  // one at a time: a webhook burst shares the pull already running
  if (!pulling) pulling = doPull().finally(() => { pulling = null; });
  return pulling;
}

async function doPull(): Promise<string> {
  const g = await googleRow();
  if (!g) return "not connected";
  const st = await getSettings();
  const tz = st.timezone || "America/New_York";
  const today = localDate(new Date(), tz);
  const services = await prisma.service.findMany();
  const menu = services.filter((s) => s.active);
  const customers = await prisma.customer.findMany({ select: { id: true, first: true, last: true } });
  // longest names first, so "Stephanie Gallo" wins over a client called just "Stephanie"
  const names = customers
    .map((c) => ({ id: c.id, words: words(`${c.first} ${c.last}`) }))
    .filter((c) => c.words.length)
    .sort((a, b) => b.words.length - a.words.length);

  const counts = { moved: 0, cancelled: 0, added: 0 };
  let token = g.syncToken;
  let pageToken = "";
  let next = "";
  for (;;) {
    const q = new URLSearchParams({ singleEvents: "true", showDeleted: "true", maxResults: "250" });
    if (pageToken) q.set("pageToken", pageToken);
    else if (token) q.set("syncToken", token);
    let j: any;
    try {
      j = await api("GET", `${cal(g)}/events?${q}`);
    } catch (e) {
      if (e instanceof GoogleError && e.status === 410 && token) {
        // the token expired: start over with a full read
        token = ""; pageToken = "";
        continue;
      }
      throw e;
    }
    for (const ev of (j.items ?? []) as any[]) await applyEvent(ev);
    if (j.nextPageToken) { pageToken = j.nextPageToken; continue; }
    next = j.nextSyncToken ?? "";
    break;
  }
  await prisma.googleCalendar.update({ where: { id: ROW }, data: { syncToken: next, lastSyncAt: new Date(), lastError: "" } });
  return `${counts.added} added, ${counts.moved} moved, ${counts.cancelled} cancelled`;

  async function applyEvent(ev: any) {
    const tagged: string | undefined = ev.extendedProperties?.private?.mhAppt;
    const a =
      (tagged && (await prisma.appointment.findUnique({ where: { id: tagged } }))) ||
      (await prisma.appointment.findFirst({ where: { googleEventId: ev.id } }));

    if (ev.status === "cancelled") {
      if (!a || a.googleEventId !== ev.id) return;
      if (a.status === "scheduled" || a.status === "confirmed") {
        await prisma.appointment.update({ where: { id: a.id }, data: { status: "cancelled", googleEventId: "", googleUpdated: "" } });
        counts.cancelled++;
      } else {
        await prisma.appointment.update({ where: { id: a.id }, data: { googleEventId: "", googleUpdated: "" } });
      }
      return;
    }
    if (!ev.start?.dateTime || !ev.end?.dateTime) return; // all-day: not an appointment

    if (a) {
      if (a.googleEventId && a.googleEventId !== ev.id) return; // a stale copy; the app's event wins
      if (a.googleUpdated && a.googleUpdated === ev.updated) return; // our own write coming back
      const s = toLocal(ev.start.dateTime, tz);
      const len = Math.max(5, Math.round((Date.parse(ev.end.dateTime) - Date.parse(ev.start.dateTime)) / 60000));
      const same = s.date === a.date && s.min === a.start && len === lengthOf(a, services);
      await prisma.appointment.update({
        where: { id: a.id },
        data: {
          googleEventId: ev.id,
          googleUpdated: ev.updated ?? "",
          ...(same ? {} : { date: s.date, start: s.min, duration: len === lengthOf({ ...a, duration: 0 }, services) ? 0 : len }),
        },
      });
      if (!same) counts.moved++;
      return;
    }

    if (tagged) return; // made by the app for an appointment since deleted
    const s = toLocal(ev.start.dateTime, tz);
    if (s.date < today) return; // only new bookings, not history
    const title = words(ev.summary ?? "");
    // longest names first, each match used up, so "Blowout + Style" isn't also Blowout and Style
    let text = norm(`${ev.summary ?? ""}\n${ev.description ?? ""}`);
    const svcs: Service[] = [];
    for (const m of [...menu].sort((x, y) => svcKey(y.name).length - svcKey(x.name).length)) {
      const k = svcKey(m.name);
      if (k && text.includes(k)) { svcs.push(m); text = text.replace(k, " "); }
    }
    const who = names.find((c) =>
      c.words.every((w, i) => title[i] === w) &&
      // a one-word client ("Beck") only when the rest of the title is a service, or nothing
      (c.words.length > 1 || title.length === 1 || svcs.length > 0));
    if (!who) return; // personal: Work, Doctor, Anna's birthday …
    const len = Math.max(5, Math.round((Date.parse(ev.end.dateTime) - Date.parse(ev.start.dateTime)) / 60000));
    const sum = svcs.reduce((t, x) => t + x.duration, 0) || 60;
    const id = "g_" + crypto.createHash("sha256").update(ev.id).digest("hex").slice(0, 20);
    try {
      await prisma.appointment.create({
        data: {
          id,
          customerId: who.id,
          date: s.date,
          start: s.min,
          duration: len === sum ? 0 : len,
          serviceIds: svcs.map((x) => x.id),
          status: "scheduled",
          notes: `Booked in Google Calendar: ${ev.summary ?? ""}`.trim(),
          googleEventId: ev.id,
          googleUpdated: ev.updated ?? "",
        },
      });
      counts.added++;
    } catch (e: any) {
      if (e?.code !== "P2002") throw e; // already made by an overlapping pull
    }
  }
}

/* ------------------------------------------------------- live updates -- */

async function stopChannel(g: GoogleCalendar) {
  if (!g.channelId || !g.channelResource) return;
  await api("POST", "/calendar/v3/channels/stop", { id: g.channelId, resourceId: g.channelResource }).catch(() => {});
  await prisma.googleCalendar.update({ where: { id: ROW }, data: { channelId: "", channelResource: "", channelExpires: null } });
}

/** Asks Google to call the webhook on every change; renewed before it runs out. */
async function ensureChannel() {
  const g = await googleRow();
  if (!g || !g.webhookUrl.startsWith("https://")) return; // Google only calls https addresses
  if (g.channelId && g.channelExpires && g.channelExpires.getTime() > Date.now() + 2 * 86400_000) return;
  const id = crypto.randomUUID();
  const token = crypto.randomBytes(24).toString("hex");
  const j = await api("POST", `${cal(g)}/events/watch`, {
    id, type: "web_hook", address: g.webhookUrl, token, params: { ttl: String(7 * 86400) },
  });
  const old = g;
  await prisma.googleCalendar.update({
    where: { id: ROW },
    data: {
      channelId: id, channelToken: token, channelResource: j.resourceId ?? "",
      channelExpires: j.expiration ? new Date(Number(j.expiration)) : new Date(Date.now() + 7 * 86400_000),
    },
  });
  if (old.channelId && old.channelResource)
    await api("POST", "/calendar/v3/channels/stop", { id: old.channelId, resourceId: old.channelResource }).catch(() => {});
}

/** Is this webhook call really from our channel? */
export async function webhookIsOurs(channelId: string, token: string): Promise<boolean> {
  const g = await googleRow();
  return Boolean(g && g.channelId && channelId === g.channelId && token === g.channelToken);
}

/**
 * The full round: push appointments that have no event yet (new imports,
 * earlier failures), pull Google's changes, keep the live channel alive.
 * Run by "Sync now", by the hourly scheduler and after connecting.
 */
export async function syncNow(): Promise<string> {
  const g = await googleRow();
  if (!g) return "not connected";
  try {
    const st = await getSettings();
    const since = addDays(localDate(new Date(), st.timezone || "America/New_York"), -1);
    const pending = await prisma.appointment.findMany({
      where: { googleEventId: "", date: { gte: since }, status: { in: ["scheduled", "confirmed", "completed", "noshow"] } },
      select: { id: true },
    });
    for (const p of pending) await pushAppointment(p.id);
    const pulled = await pull();
    await ensureChannel().catch((e) => noteError(e));
    return `${pending.length} sent to Google; ${pulled}`;
  } catch (e) {
    await noteError(e);
    throw e;
  }
}

async function noteError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("google sync:", msg);
  await prisma.googleCalendar.updateMany({ where: { id: ROW }, data: { lastError: msg.slice(0, 500) } }).catch(() => {});
}
async function noteOk() {
  await prisma.googleCalendar.updateMany({ where: { id: ROW, NOT: { lastError: "" } }, data: { lastError: "" } }).catch(() => {});
}
