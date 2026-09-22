import { prisma } from "@/lib/prisma";
import { storage } from "@/lib/storage";
import { ApiError, fail, handle, noContent, ok, readJson, requireApiSession } from "@/lib/api";
import { photoOut } from "@/lib/records";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** The bytes. Behind the login, never a public URL. */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  await requireApiSession();
  const { id } = await ctx.params;
  const photo = await prisma.photo.findUnique({ where: { id } });
  if (!photo) return fail("Not found.", 404);
  const size = new URL(req.url).searchParams.get("size");
  const stored = await storage().get(size === "thumb" ? photo.thumbKey : photo.fullKey);
  if (!stored) return fail("The image file is missing from storage.", 404);
  return new Response(new Uint8Array(stored.body), {
    headers: {
      "Content-Type": stored.mime || photo.mime,
      "Content-Length": String(stored.body.length),
      "Cache-Control": "private, max-age=86400",
    },
  });
});

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  await requireApiSession();
  const { id } = await ctx.params;
  const body = await readJson(req);
  const data: { caption?: string; tag?: string } = {};
  if (typeof body.caption === "string") data.caption = body.caption.slice(0, 500);
  if (typeof body.tag === "string") data.tag = body.tag.slice(0, 40);
  const photo = await prisma.photo.update({ where: { id }, data });
  return ok(photoOut(photo));
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  await requireApiSession();
  const { id } = await ctx.params;
  const photo = await prisma.photo.findUnique({ where: { id } });
  if (!photo) throw new ApiError("Not found.", 404);
  const store = storage();
  await Promise.all([store.del(photo.fullKey), store.del(photo.thumbKey)]);
  await prisma.photo.delete({ where: { id } });
  return noContent();
});
