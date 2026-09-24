import crypto from "node:crypto";
import { prisma } from "./prisma";

/**
 * Client list import from a CSV, such as a Square customer export.
 *
 * Columns are matched by name, loosely, so a hand-made sheet with
 * "First, Last, Phone, Email" works as well as Square's full export.
 * A Square row keeps a stable id (`sq_<Square Customer ID>`), so importing
 * the same export twice updates rather than duplicates. Rows without one
 * are matched to an existing client by phone or email.
 */

export type ImportSummary = {
  total: number;
  added: number;
  updated: number;
  skipped: number;
  problems: string[];
};

/* ------------------------------------------------------------- parsing -- */

/** RFC 4180-ish: quotes, escaped quotes, commas and newlines inside quotes, CRLF, BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ",") { row.push(cell); cell = ""; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Which column holds what, by header name. */
const COLUMNS: Record<string, string[]> = {
  first: ["firstname", "first", "givenname"],
  last: ["lastname", "last", "surname", "familyname"],
  name: ["name", "fullname", "customername", "clientname"],
  email: ["emailaddress", "email", "emails"],
  phone: ["phonenumber", "phone", "mobile", "cell", "cellphone", "mobilephone", "telephone"],
  dob: ["birthday", "dateofbirth", "dob", "birthdate"],
  street1: ["streetaddress1", "address1", "streetaddress", "address", "street"],
  street2: ["streetaddress2", "address2"],
  city: ["city", "town"],
  state: ["state", "province", "region"],
  postal: ["postalcode", "zip", "zipcode", "postcode"],
  memo: ["memo", "notes", "note", "comments"],
  squareId: ["squarecustomerid", "customerid"],
  emailSub: ["emailsubscriptionstatus", "emailstatus"],
  firstVisit: ["firstvisit", "createdat", "created", "since"],
  hairType: ["hairtype"],
  formula: ["formula", "colourformula", "colorformula"],
  allergies: ["allergies"],
};

function columnMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  const normed = headers.map(norm);
  for (const [key, names] of Object.entries(COLUMNS)) {
    for (const n of names) {
      const i = normed.indexOf(n);
      if (i >= 0) { map[key] = i; break; }
    }
  }
  return map;
}

/* ------------------------------------------------------------ cleaning -- */

const clean = (v: string | undefined) => String(v ?? "").replace(/\s+/g, " ").trim();

/** Square exports phones as '+13472075393 (leading apostrophe). Shown as (347) 207-5393. */
export function cleanPhone(raw: string): string {
  const s = clean(raw).replace(/^'+/, "");
  if (!s) return "";
  const digits = s.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1"))
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return s.startsWith("+") ? "+" + digits : s;
}

/** Digits only, with a leading 1 for US numbers, for matching. */
export function phoneKey(raw: string): string {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return "";
  return d.length === 10 ? "1" + d : d;
}

/** "1990-03-14", "03/14/1990", "3/14", "March 14" → "1990-03-14" or "--03-14". */
export function cleanDob(raw: string): string {
  const s = clean(raw);
  if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^--?(\d{1,2})-(\d{1,2})$/);
  if (m) return `--${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? "19" + m[3] : m[3]) : "-";
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  m = s.toLowerCase().match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/);
  if (m && months.includes(m[1]))
    return `${m[3] ?? "-"}-${String(months.indexOf(m[1]) + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return "";
}

function dateOrNull(raw: string): Date | null {
  const s = clean(raw);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* ------------------------------------------------------------- import -- */

type Draft = {
  id: string | null;
  first: string;
  last: string;
  email: string;
  phone: string;
  dob: string;
  address: string;
  memo: string;
  emailOptOut: boolean;
  createdAt: Date | null;
  hairType: string;
  formula: string;
  allergies: string;
};

function draftFrom(cols: Record<string, number>, row: string[]): Draft | null {
  const g = (k: string) => (cols[k] == null ? "" : clean(row[cols[k]]));
  let first = g("first"), last = g("last");
  if (!first && !last && cols.name != null) {
    const parts = g("name").split(" ");
    first = parts.shift() ?? "";
    last = parts.join(" ");
  }
  const email = g("email").toLowerCase();
  const phone = cleanPhone(g("phone"));
  if (!first && !last && !email && !phone) return null;
  const address = [
    [g("street1"), g("street2")].filter(Boolean).join(", "),
    [g("city"), [g("state"), g("postal")].filter(Boolean).join(" ")].filter(Boolean).join(", "),
  ].filter(Boolean).join(", ");
  const sq = g("squareId");
  return {
    id: sq ? "sq_" + sq.replace(/[^A-Za-z0-9_-]/g, "") : null,
    first, last, email, phone,
    dob: cleanDob(g("dob")),
    address,
    memo: g("memo"),
    emailOptOut: /unsub/i.test(g("emailSub")),
    createdAt: dateOrNull(g("firstVisit")),
    hairType: g("hairType"),
    formula: g("formula"),
    allergies: g("allergies"),
  };
}

export function fileHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export async function importCustomers(csvText: string): Promise<ImportSummary> {
  const rows = parseCsv(csvText);
  const summary: ImportSummary = { total: 0, added: 0, updated: 0, skipped: 0, problems: [] };
  if (rows.length < 2) { summary.problems.push("The file has no client rows."); return summary; }

  const cols = columnMap(rows[0]);
  if (cols.first == null && cols.name == null && cols.email == null && cols.phone == null) {
    summary.problems.push("Couldn't find a name, phone or email column. The first row should be the column names.");
    return summary;
  }

  // what's already in the book, for matching rows that carry no Square id
  const existing = await prisma.customer.findMany({ select: { id: true, phone: true, email: true } });
  const byPhone = new Map<string, string>();
  const byEmail = new Map<string, string>();
  for (const c of existing) {
    const pk = phoneKey(c.phone); if (pk && !byPhone.has(pk)) byPhone.set(pk, c.id);
    const ek = c.email.trim().toLowerCase(); if (ek && !byEmail.has(ek)) byEmail.set(ek, c.id);
  }
  const seen = new Set<string>();

  for (let r = 1; r < rows.length; r++) {
    const d = draftFrom(cols, rows[r]);
    if (!d) continue;
    summary.total++;
    const pk = phoneKey(d.phone);
    const matchId = d.id ?? (pk && byPhone.get(pk)) ?? (d.email && byEmail.get(d.email)) ?? null;
    const dupKey = d.id ?? (pk ? "p:" + pk : d.email ? "e:" + d.email : `${d.first} ${d.last}`.toLowerCase());
    if (seen.has(dupKey)) { summary.skipped++; continue; }
    seen.add(dupKey);

    // fields we only fill in, never blank out, on an existing client
    const fill = {
      ...(d.email ? { email: d.email } : {}),
      ...(d.phone ? { phone: d.phone } : {}),
      ...(d.dob ? { dob: d.dob } : {}),
      ...(d.address ? { address: d.address } : {}),
      ...(d.hairType ? { hairType: d.hairType } : {}),
      ...(d.formula ? { formula: d.formula } : {}),
      ...(d.allergies ? { allergies: d.allergies } : {}),
      ...(d.emailOptOut ? { emailOptOut: true } : {}),
    };

    try {
      if (matchId && existing.some((c) => c.id === matchId)) {
        await prisma.customer.update({
          where: { id: matchId },
          data: { ...fill, ...(d.first ? { first: d.first } : {}), ...(d.last ? { last: d.last } : {}) },
        });
        if (d.memo && !(await prisma.note.findFirst({ where: { customerId: matchId, text: d.memo } }))) {
          await prisma.note.create({ data: { customerId: matchId, text: d.memo, tag: "Imported" } });
        }
        summary.updated++;
      } else {
        const created = await prisma.customer.create({
          data: {
            ...(d.id ? { id: d.id } : {}),
            first: d.first,
            last: d.last,
            ...fill,
            ...(d.createdAt ? { createdAt: d.createdAt } : {}),
          },
        });
        existing.push({ id: created.id, phone: created.phone, email: created.email });
        if (pk) byPhone.set(pk, created.id);
        if (d.email) byEmail.set(d.email, created.id);
        summary.added++;
        if (d.memo) {
          await prisma.note.create({ data: { customerId: created.id, text: d.memo, tag: "Imported" } });
        }
      }
    } catch (e: unknown) {
      summary.skipped++;
      const who = `${d.first} ${d.last}`.trim() || d.email || d.phone || `row ${r + 1}`;
      summary.problems.push(`${who}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return summary;
}
