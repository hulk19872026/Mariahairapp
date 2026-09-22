import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/automation";
import { integrationStatus } from "@/lib/senders";
import { storageName, storageReady } from "@/lib/storage";
import { handle, ok, requireApiSession } from "@/lib/api";
import {
  appointmentOut,
  couponOut,
  customerOut,
  messageOut,
  noteOut,
  photoOut,
  productOut,
  serviceOut,
  settingsOut,
} from "@/lib/records";

export const dynamic = "force-dynamic";

// The storage write-check is slow against R2; remember the answer for a while.
let photoCheck: { ok: boolean; at: number } | null = null;
async function photosWritable(): Promise<boolean> {
  if (photoCheck && Date.now() - photoCheck.at < 10 * 60_000) return photoCheck.ok;
  const ok = await storageReady();
  photoCheck = { ok, at: Date.now() };
  return ok;
}

/** Everything the app screen needs, in one round trip. */
export const GET = handle(async () => {
  await requireApiSession();
  const [settings, customers, services, products, appts, notes, msgs, photos, coupons, lastRun, photosOk] =
    await Promise.all([
      getSettings(),
      prisma.customer.findMany({ orderBy: [{ last: "asc" }, { first: "asc" }] }),
      prisma.service.findMany({ orderBy: { name: "asc" } }),
      prisma.product.findMany({ orderBy: { name: "asc" } }),
      prisma.appointment.findMany({ orderBy: [{ date: "asc" }, { start: "asc" }] }),
      prisma.note.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.messageLog.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
      prisma.photo.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.coupon.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.cronRun.findFirst({ orderBy: { startedAt: "desc" } }),
      photosWritable(),
    ]);

  return ok({
    settings: settingsOut(settings),
    customers: customers.map(customerOut),
    services: services.map(serviceOut),
    products: products.map(productOut),
    appts: appts.map(appointmentOut),
    notes: notes.map(noteOut),
    msgs: msgs.map(messageOut),
    photos: photos.map(photoOut),
    coupons: coupons.map(couponOut),
    integrations: { ...integrationStatus(), photos: photosOk, photoStore: storageName() },
    lastRun: lastRun
      ? { at: lastRun.startedAt.getTime(), sent: lastRun.sent, failed: lastRun.failed, skipped: lastRun.skipped }
      : null,
  });
});
