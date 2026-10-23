import crypto from "node:crypto";
import { prisma } from "./prisma";
import { getSettings, localDate } from "./automation";
import { cleanPhone, parseCsv, phoneKey } from "./records-import";

/**
 * Appointments from a spreadsheet — for bringing over a calendar kept
 * somewhere else (Square Free has no export, so its calendar is copied into
 * a CSV by hand or by Claude from a screenshot).
 *
 * Columns, matched loosely by name: Date, Time, Client (or First / Last
 * Name), Square Customer ID, Phone, Email, Service, Duration, Price, Status,
 * Notes. Only Date, Time and a client are required.
 *
 * - The client is found by Square id, then phone, then email, then exact
 *   full name (only when one client has it). Nobody found → a new client.
 * - Each row gets a stable id from date + time + client, so importing the
 *   same file twice adds nothing and never overwrites later edits.
 * - Without a Status, past dates import as completed (paid in Square, so
 *   they never sit in "Waiting on payment") and later ones as scheduled.
 * - Upcoming ones are marked as already confirmed: the client got that from
 *   Square, so the scheduler doesn't send a second confirmation.
 */

export type ApptImportSummary = {
  total: number;
  added: number;
  existing: number;
  newClients: number;
  skipped: number;
  problems: string[];
};

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
const clean = (v: string | undefined) => String(v ?? "").replace(/\s+/g, " ").trim();

const COLUMNS: Record<string, string[]> = {
  date: ["date", "day", "appointmentdate"],
  time: ["time", "start", "starttime", "appointmenttime"],
  name: ["client", "clientname", "customer", "customername", "name"],
  first: ["firstname", "first"],
  last: ["lastname", "last", "surname"],
  squareId: ["squarecustomerid", "customerid"],
  phone: ["phone", "phonenumber", "mobile"],
  email: ["email", "emailaddress"],
  service: ["service", "services"],
  duration: ["duration", "durationmin", "durationminutes", "minutes", "length"],
  price: ["price", "amount", "total"],
  status: ["status"],
  notes: ["notes", "note", "memo"],
};

const STATUSES = ["scheduled", "confirmed", "completed", "cancelled", "noshow"];

/** "2026-10-03", "10/3/2026", "Oct 3, 2026" → "2026-10-03" */
function isoDate(raw: string): string {
  const s = clean(raw);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const d = new Date(s);
  if (s && !Number.isNaN(d.getTime()))
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return "";
}

/** "9:30 AM", "14:00", "2pm" → minutes from midnight, or -1 */
function minutes(raw: string): number {
  const m = clean(raw).toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/);
  if (!m) return -1;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3]?.startsWith("p") && h < 12) h += 12;
  if (m[3]?.startsWith("a") && h === 12) h = 0;
  return h > 23 || min > 59 ? -1 : h * 60 + min;
}

const nameKey = (first: string, last: string) => norm(`${first} ${last}`);

export async function importAppointments(csvText: string): Promise<ApptImportSummary> {
  const summary: ApptImportSummary = { total: 0, added: 0, existing: 0, newClients: 0, skipped: 0, problems: [] };
  const rows = parseCsv(csvText);
  if (rows.length < 2) { summary.problems.push("The file has no appointment rows."); return summary; }

  const cols: Record<string, number> = {};
  rows[0].forEach((h, i) => {
    const n = norm(h);
    for (const [k, names] of Object.entries(COLUMNS)) if (cols[k] == null && names.includes(n)) cols[k] = i;
  });
  if (cols.date == null || cols.time == null || (cols.name == null && cols.first == null)) {
    summary.problems.push("The file needs Date, Time and Client (or First Name) columns.");
    return summary;
  }

  const st = await getSettings();
  const today = localDate(new Date(), st.timezone || "America/New_York");
  const services = await prisma.service.findMany();
  const svcByName = new Map(services.map((s) => [norm(s.name), s]));

  const customers = await prisma.customer.findMany({ select: { id: true, first: true, last: true, phone: true, email: true } });
  const byId = new Set(customers.map((c) => c.id));
  const byPhone = new Map<string, string>();
  const byEmail = new Map<string, string>();
  const byName = new Map<string, string | null>(); // null = more than one client has it
  const index = (c: { id: string; first: string; last: string; phone: string; email: string }) => {
    const pk = phoneKey(c.phone); if (pk && !byPhone.has(pk)) byPhone.set(pk, c.id);
    const ek = c.email.trim().toLowerCase(); if (ek && !byEmail.has(ek)) byEmail.set(ek, c.id);
    const nk = nameKey(c.first, c.last); if (nk) byName.set(nk, byName.has(nk) ? null : c.id);
  };
  customers.forEach(index);

  for (let r = 1; r < rows.length; r++) {
    const g = (k: string) => (cols[k] == null ? "" : clean(rows[r][cols[k]]));
    if (rows[r].every((v) => !clean(v))) continue;
    summary.total++;

    let first = g("first"), last = g("last");
    if (!first && !last) { const p = g("name").split(" "); first = p.shift() ?? ""; last = p.join(" "); }
    const who = `${first} ${last}`.trim() || `row ${r + 1}`;
    const date = isoDate(g("date"));
    const start = minutes(g("time"));
    if (!date || start < 0) { summary.skipped++; summary.problems.push(`${who}: couldn't read the date or time.`); continue; }
    if (!first && !last) { summary.skipped++; summary.problems.push(`Row ${r + 1}: no client name.`); continue; }

    try {
      // the client
      const sq = g("squareId") ? "sq_" + g("squareId").replace(/[^A-Za-z0-9_-]/g, "") : "";
      const phone = cleanPhone(g("phone"));
      const email = g("email").toLowerCase();
      let customerId =
        (sq && byId.has(sq) ? sq : "") ||
        byPhone.get(phoneKey(phone)) ||
        (email && byEmail.get(email)) ||
        byName.get(nameKey(first, last)) ||
        "";
      if (!customerId) {
        const c = await prisma.customer.create({
          data: { ...(sq ? { id: sq } : {}), first, last, phone, email },
        });
        customerId = c.id;
        byId.add(c.id);
        index({ id: c.id, first, last, phone, email });
        summary.newClients++;
      }

      // the appointment, once
      const id = "imp_" + crypto.createHash("sha256").update(`${date}|${start}|${customerId}`).digest("hex").slice(0, 20);
      if (await prisma.appointment.findUnique({ where: { id }, select: { id: true } })) { summary.existing++; continue; }

      const svcName = g("service");
      const svc = svcName ? svcByName.get(norm(svcName)) : undefined;
      const statusIn = norm(g("status"));
      const status = STATUSES.includes(statusIn) ? statusIn : date < today ? "completed" : "scheduled";
      const price = g("price") === "" ? null : Number(g("price").replace(/[^0-9.]/g, ""));
      const notes = [svcName && !svc ? `Service: ${svcName}` : "", g("notes")].filter(Boolean).join("\n");

      await prisma.appointment.create({
        data: {
          id,
          customerId,
          date,
          start,
          duration: Math.max(0, Math.round(Number(g("duration")) || 0)),
          serviceIds: svc ? [svc.id] : [],
          priceOverride: price != null && Number.isFinite(price) ? price : null,
          status,
          notes,
          ...(status === "completed" ? { payStatus: "paid", payMethod: "Square" } : {}),
        },
      });

      if (status === "scheduled" || status === "confirmed") {
        await prisma.messageLog.createMany({
          data: (["email", "sms"] as const).map((ch) => ({
            customerId,
            appointmentId: id,
            kind: "confirm",
            channel: ch,
            to: "",
            body: "Booked in Square, which already confirmed it.",
            status: "skipped",
            dedupeKey: `confirm:${id}:${ch}`,
          })),
          skipDuplicates: true,
        });
      }
      summary.added++;
    } catch (e: unknown) {
      summary.skipped++;
      summary.problems.push(`${who}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return summary;
}
