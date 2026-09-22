import { prisma } from "@/lib/prisma";
import { makeKey, storage } from "@/lib/storage";
import { ApiError, handle, ok, requireApiSession } from "@/lib/api";
import { photoOut } from "@/lib/records";

export const dynamic = "force-dynamic";

const MAX_BYTES = 12 * 1024 * 1024;

async function part(fd: FormData, name: string): Promise<{ buf: Buffer; mime: string } | null> {
  const f = fd.get(name);
  if (!f || typeof f === "string") return null;
  if (f.size > MAX_BYTES) throw new ApiError("That photo is too large.");
  const buf = Buffer.from(await f.arrayBuffer());
  const mime = f.type && f.type.startsWith("image/") ? f.type : "image/jpeg";
  return { buf, mime };
}

/**
 * Multipart upload from the app screen: the browser has already shrunk the
 * image into a `full` and a `thumb` JPEG, so nothing is resized here.
 */
export const POST = handle(async (req: Request) => {
  await requireApiSession();
  const fd = await req.formData();
  const customerId = String(fd.get("customerId") ?? "").trim();
  if (!customerId) throw new ApiError("Which client is this photo for?");
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new ApiError("That client no longer exists.", 404);

  const full = await part(fd, "full");
  const thumb = (await part(fd, "thumb")) ?? full;
  if (!full) throw new ApiError("No image was attached.");

  const apptRaw = String(fd.get("appointmentId") ?? fd.get("apptId") ?? "").trim();
  const appointmentId =
    apptRaw && (await prisma.appointment.findUnique({ where: { id: apptRaw } })) ? apptRaw : null;

  const ext = full.mime === "image/png" ? "png" : "jpg";
  const fullKey = makeKey(customerId, "full", ext);
  const thumbKey = makeKey(customerId, "thumb", ext);
  const store = storage();
  await store.put(fullKey, full.buf, full.mime);
  await store.put(thumbKey, thumb!.buf, thumb!.mime);

  const photo = await prisma.photo.create({
    data: {
      customerId,
      appointmentId,
      tag: String(fd.get("tag") ?? "").slice(0, 40),
      caption: String(fd.get("caption") ?? "").slice(0, 500),
      fullKey,
      thumbKey,
      mime: full.mime,
      width: Number(fd.get("width")) || 0,
      height: Number(fd.get("height")) || 0,
      bytes: full.buf.length,
    },
  });
  return ok(photoOut(photo), 201);
});
