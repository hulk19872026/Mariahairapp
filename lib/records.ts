import type {
  Appointment,
  Coupon,
  Customer,
  MessageLog,
  Note,
  Photo,
  Prisma,
  Product,
  Service,
  Settings,
} from "@prisma/client";
import { prisma } from "./prisma";

/**
 * The app screen (app.html) keeps its records in its own shape — nested
 * `hair`, `auto`, `payment` objects, `apptId`, epoch-millisecond dates. The
 * database keeps them flat and typed. Everything that crosses between the two
 * goes through here, so neither side has to know about the other.
 */

type Rec = Record<string, unknown>;

const str = (v: unknown, d = ""): string => (v == null ? d : String(v));
const num = (v: unknown, d = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const int = (v: unknown, d = 0): number => Math.round(num(v, d));
const bool = (v: unknown, d = false): boolean => (v == null ? d : Boolean(v));
const obj = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const ms = (d: Date | null | undefined): number | null => (d ? d.getTime() : null);
const date = (v: unknown): Date | null => {
  if (v == null || v === "" || v === false) return null;
  const d = new Date(typeof v === "string" && /^\d+$/.test(v) ? Number(v) : (v as number | string));
  return Number.isNaN(d.getTime()) ? null : d;
};
const dec = (v: unknown): number => num(v && typeof v === "object" ? String(v) : v);
const json = (v: unknown, d: Prisma.InputJsonValue): Prisma.InputJsonValue =>
  v == null ? d : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

/* ------------------------------------------------------------ settings -- */

export function settingsOut(s: Settings) {
  const extra = obj(s.extra);
  const notify = obj(extra.notify);
  const autoDefaults = obj(extra.autoDefaults);
  const biz = obj(extra.biz);
  return {
    id: "business",
    currency: s.currency,
    palette: s.palette,
    timezone: s.timezone,
    biz: {
      name: s.bizName,
      stylist: s.stylist,
      phone: s.phone,
      email: s.email,
      address: s.address,
      website: s.website,
      logo: str(biz.logo),
    },
    hours: s.hours ?? {},
    closures: s.closures ?? [],
    slot: s.slot,
    buffer: int(extra.buffer, 0),
    notify: {
      sms: bool(notify.sms, true),
      email: bool(notify.email, true),
      confirm: s.sendConfirm,
      night: s.sendNight,
      r2: s.sendDayOf,
      rebook: s.sendRebook,
      birthday: s.sendBirthday,
      r2h: s.dayOfHours,
    },
    birthdayHour: s.birthdayHour,
    coupon: {
      on: s.couponOn,
      type: s.couponType,
      value: dec(s.couponValue),
      days: s.couponDays,
      note: s.couponNote,
    },
    nightHour: s.nightHour,
    autoDefaults: {
      nightBefore: bool(autoDefaults.nightBefore, true),
      rebookOn: bool(autoDefaults.rebookOn, true),
      rebookDays: s.rebookDays,
    },
    followupWeeks: s.followupWeeks,
    tpl: s.templates ?? {},
    seeded: bool(extra.seeded, false),
  };
}

export function settingsIn(v: Rec): Prisma.SettingsUpdateInput {
  const biz = obj(v.biz);
  const notify = obj(v.notify);
  const coupon = obj(v.coupon);
  const auto = obj(v.autoDefaults);
  const extra: Prisma.InputJsonObject = {
    buffer: int(v.buffer, 0),
    seeded: bool(v.seeded, false),
    biz: { logo: str(biz.logo) },
    notify: { sms: bool(notify.sms, true), email: bool(notify.email, true) },
    autoDefaults: {
      nightBefore: bool(auto.nightBefore, true),
      rebookOn: bool(auto.rebookOn, true),
    },
  };
  const out: Prisma.SettingsUpdateInput = {
    currency: str(v.currency, "$") || "$",
    palette: str(v.palette, "fuchsia") || "fuchsia",
    bizName: str(biz.name),
    stylist: str(biz.stylist),
    phone: str(biz.phone),
    email: str(biz.email),
    address: str(biz.address),
    website: str(biz.website),
    hours: json(v.hours, {}),
    closures: json(v.closures, []),
    slot: Math.max(5, int(v.slot, 15)),
    sendConfirm: bool(notify.confirm, true),
    sendNight: bool(notify.night, true),
    sendDayOf: bool(notify.r2, true),
    sendRebook: bool(notify.rebook, true),
    sendBirthday: bool(notify.birthday, true),
    dayOfHours: Math.max(0, int(notify.r2h, 2)),
    birthdayHour: Math.min(23, Math.max(0, int(v.birthdayHour, 9))),
    couponOn: bool(coupon.on, false),
    couponType: coupon.type === "amount" ? "amount" : "percent",
    couponValue: num(coupon.value, 15),
    couponDays: Math.max(1, int(coupon.days, 30)),
    couponNote: str(coupon.note),
    nightHour: Math.min(23, Math.max(0, int(v.nightHour, 19))),
    rebookDays: Math.max(1, int(auto.rebookDays, 60)),
    followupWeeks: Math.max(1, int(v.followupWeeks, 6)),
    templates: json(v.tpl, {}),
    extra,
  };
  if (typeof v.timezone === "string" && v.timezone.trim()) out.timezone = v.timezone.trim();
  return out;
}

/* ----------------------------------------------------------- customers -- */

export function customerOut(c: Customer) {
  return {
    id: c.id,
    first: c.first,
    last: c.last,
    phone: c.phone,
    email: c.email,
    dob: c.dob,
    address: c.address,
    contactPref: c.contact,
    photo: c.photo,
    smsConsent: c.smsConsent,
    smsConsentAt: ms(c.smsConsentAt),
    smsConsentHow: c.smsConsentHow,
    smsOptOut: c.smsOptOut,
    emailOptOut: c.emailOptOut,
    createdAt: c.createdAt.getTime(),
    hair: {
      type: c.hairType,
      style: c.hairStyle,
      formula: c.formula,
      products: c.productsUsed,
      allergies: c.allergies,
      instructions: c.instructions,
    },
    auto: {
      nightBefore: c.autoNightBefore,
      rebookOn: c.autoRebook,
      rebookDays: c.rebookDays,
      birthday: c.autoBirthday,
    },
  };
}

function customerIn(v: Rec): Prisma.CustomerUncheckedCreateInput {
  const hair = obj(v.hair);
  const auto = obj(v.auto);
  return {
    id: str(v.id),
    first: str(v.first),
    last: str(v.last),
    phone: str(v.phone),
    email: str(v.email),
    dob: str(v.dob),
    address: str(v.address),
    contact: str(v.contactPref ?? v.contact, "Text"),
    photo: str(v.photo),
    smsConsent: bool(v.smsConsent),
    smsConsentAt: bool(v.smsConsent) ? date(v.smsConsentAt) ?? new Date() : null,
    smsConsentHow: str(v.smsConsentHow),
    smsOptOut: bool(v.smsOptOut),
    emailOptOut: bool(v.emailOptOut),
    createdAt: date(v.createdAt) ?? new Date(),
    hairType: str(hair.type),
    hairStyle: str(hair.style),
    formula: str(hair.formula),
    productsUsed: str(hair.products),
    allergies: str(hair.allergies),
    instructions: str(hair.instructions),
    autoNightBefore: bool(auto.nightBefore, true),
    autoRebook: bool(auto.rebookOn, true),
    rebookDays: Math.max(1, int(auto.rebookDays, 60)),
    autoBirthday: bool(auto.birthday, true),
  };
}

/* ------------------------------------------------------------ services -- */

export function serviceOut(s: Service) {
  return {
    id: s.id,
    name: s.name,
    desc: s.desc,
    price: dec(s.price),
    duration: s.duration,
    category: s.category,
    active: s.active,
  };
}

function serviceIn(v: Rec): Prisma.ServiceUncheckedCreateInput {
  return {
    id: str(v.id),
    name: str(v.name, "Service"),
    desc: str(v.desc),
    price: num(v.price),
    duration: Math.max(5, int(v.duration, 45)),
    category: str(v.category, "Other") || "Other",
    active: bool(v.active, true),
  };
}

/* ------------------------------------------------------------ products -- */

export function productOut(p: Product) {
  return {
    id: p.id,
    name: p.name,
    brand: p.brand,
    category: p.category,
    cost: dec(p.cost),
    price: dec(p.price),
    qty: p.qty,
    minQty: p.minQty,
    sku: p.sku,
    notes: p.notes,
  };
}

function productIn(v: Rec): Prisma.ProductUncheckedCreateInput {
  return {
    id: str(v.id),
    name: str(v.name, "Product"),
    brand: str(v.brand),
    category: str(v.category),
    cost: num(v.cost),
    price: num(v.price),
    qty: int(v.qty),
    minQty: int(v.minQty),
    sku: str(v.sku),
    notes: str(v.notes),
  };
}

/* -------------------------------------------------------- appointments -- */

export function appointmentOut(a: Appointment) {
  return {
    id: a.id,
    customerId: a.customerId,
    serviceIds: a.serviceIds,
    date: a.date,
    start: a.start,
    duration: a.duration || undefined,
    priceOverride: a.priceOverride == null ? null : dec(a.priceOverride),
    status: a.status,
    notes: a.notes,
    createdAt: a.createdAt.getTime(),
    products: a.products ?? [],
    payment: {
      discount: dec(a.discount),
      deposit: dec(a.deposit),
      depositMethod: a.depositMethod,
      tip: dec(a.tip),
      method: a.payMethod,
      status: a.payStatus,
      paidAt: ms(a.paidAt),
    },
  };
}

function appointmentIn(v: Rec): Prisma.AppointmentUncheckedCreateInput {
  const pay = obj(v.payment);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str(v.date))) throw new Error("An appointment needs a date.");
  return {
    id: str(v.id),
    customerId: str(v.customerId),
    serviceIds: Array.isArray(v.serviceIds) ? v.serviceIds.map(String) : [],
    date: str(v.date),
    start: Math.min(1439, Math.max(0, int(v.start))),
    duration: Math.max(0, int(v.duration)),
    priceOverride: v.priceOverride == null || v.priceOverride === "" ? null : num(v.priceOverride),
    status: str(v.status, "scheduled") || "scheduled",
    notes: str(v.notes),
    createdAt: date(v.createdAt) ?? new Date(),
    products: json(v.products, []),
    discount: Math.max(0, num(pay.discount)),
    deposit: Math.max(0, num(pay.deposit)),
    depositMethod: str(pay.depositMethod),
    tip: num(pay.tip),
    payMethod: str(pay.method),
    payStatus: str(pay.status, "unpaid") || "unpaid",
    paidAt: date(pay.paidAt),
  };
}

/* --------------------------------------------------------------- notes -- */

export function noteOut(n: Note) {
  return {
    id: n.id,
    customerId: n.customerId,
    apptId: n.appointmentId,
    text: n.text,
    tag: n.tag,
    createdAt: n.createdAt.getTime(),
  };
}

function noteIn(v: Rec): Prisma.NoteUncheckedCreateInput {
  return {
    id: str(v.id),
    customerId: str(v.customerId),
    appointmentId: v.apptId ? str(v.apptId) : null,
    text: str(v.text),
    tag: str(v.tag),
    createdAt: date(v.createdAt) ?? new Date(),
  };
}

/* ------------------------------------------------------------ messages -- */

export function messageOut(m: MessageLog) {
  return {
    id: m.id,
    customerId: m.customerId,
    apptId: m.appointmentId,
    kind: m.kind,
    channel: m.channel,
    to: m.to,
    subject: m.subject,
    body: m.body,
    status: m.status,
    error: m.error,
    auto: m.auto,
    sentAt: (m.sentAt ?? m.createdAt).getTime(),
    createdAt: m.createdAt.getTime(),
  };
}

/** A message the stylist sent by hand (from her own phone), logged for the record. */
function messageIn(v: Rec): Prisma.MessageLogUncheckedCreateInput {
  const id = str(v.id);
  return {
    id,
    customerId: str(v.customerId),
    appointmentId: v.apptId ? str(v.apptId) : null,
    kind: str(v.kind, "manual") || "manual",
    channel: v.channel === "email" ? "email" : "sms",
    to: str(v.to),
    subject: str(v.subject),
    body: str(v.body),
    status: str(v.status, "sent") || "sent",
    auto: false,
    dedupeKey: `manual:${id}`,
    sentAt: date(v.sentAt) ?? new Date(),
  };
}

/* -------------------------------------------------------------- photos -- */

export function photoOut(p: Photo) {
  return {
    id: p.id,
    customerId: p.customerId,
    apptId: p.appointmentId,
    tag: p.tag,
    caption: p.caption,
    width: p.width,
    height: p.height,
    bytes: p.bytes,
    createdAt: p.createdAt.getTime(),
  };
}

/* ------------------------------------------------------------- coupons -- */

export function couponOut(c: Coupon) {
  return {
    id: c.id,
    code: c.code,
    customerId: c.customerId,
    kind: c.kind,
    year: c.year,
    type: c.type,
    value: dec(c.value),
    note: c.note,
    expiresOn: c.expiresOn,
    redeemedAt: ms(c.redeemedAt),
    apptId: c.appointmentId,
    createdAt: c.createdAt.getTime(),
  };
}

/* ----------------------------------------------------- generic upserts -- */

export const KINDS = ["customers", "services", "products", "appts", "notes", "msgs"] as const;
export type Kind = (typeof KINDS)[number];

export function isKind(k: string): k is Kind {
  return (KINDS as readonly string[]).includes(k);
}

function splitId<T extends { id?: string }>(d: T): { id: string; rest: Omit<T, "id"> } {
  const { id, ...rest } = d;
  return { id: String(id), rest };
}

/** Insert or replace one record from the app screen, returning it in app shape. */
export async function upsertRecord(kind: Kind, body: Rec): Promise<Rec> {
  if (!str(body.id).trim()) throw new Error("Record is missing an id.");
  switch (kind) {
    case "customers": {
      const { id, rest } = splitId(customerIn(body));
      return customerOut(await prisma.customer.upsert({ where: { id }, create: { id, ...rest }, update: rest }));
    }
    case "services": {
      const { id, rest } = splitId(serviceIn(body));
      return serviceOut(await prisma.service.upsert({ where: { id }, create: { id, ...rest }, update: rest }));
    }
    case "products": {
      const { id, rest } = splitId(productIn(body));
      return productOut(await prisma.product.upsert({ where: { id }, create: { id, ...rest }, update: rest }));
    }
    case "appts": {
      const { id, rest } = splitId(appointmentIn(body));
      return appointmentOut(
        await prisma.appointment.upsert({ where: { id }, create: { id, ...rest }, update: rest })
      );
    }
    case "notes": {
      const { id, rest } = splitId(noteIn(body));
      return noteOut(await prisma.note.upsert({ where: { id }, create: { id, ...rest }, update: rest }));
    }
    case "msgs": {
      const { id, rest } = splitId(messageIn(body));
      const { dedupeKey: _dedupe, ...update } = rest;
      return messageOut(
        await prisma.messageLog.upsert({ where: { id }, create: { id, ...rest }, update })
      );
    }
  }
}

export async function deleteRecord(kind: Kind, id: string): Promise<void> {
  const where = { where: { id } };
  switch (kind) {
    case "customers":
      await prisma.customer.deleteMany(where);
      return;
    case "services":
      await prisma.service.deleteMany(where);
      return;
    case "products":
      await prisma.product.deleteMany(where);
      return;
    case "appts":
      await prisma.appointment.deleteMany(where);
      return;
    case "notes":
      await prisma.note.deleteMany(where);
      return;
    case "msgs":
      await prisma.messageLog.deleteMany(where);
      return;
  }
}
