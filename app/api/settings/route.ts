import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/automation";
import { handle, ok, readJson, requireApiSession } from "@/lib/api";
import { settingsIn, settingsOut } from "@/lib/records";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await requireApiSession();
  return ok(settingsOut(await getSettings()));
});

export const PUT = handle(async (req: Request) => {
  await requireApiSession();
  const body = await readJson(req);
  await getSettings(); // make sure the row exists
  const saved = await prisma.settings.update({ where: { id: "business" }, data: settingsIn(body) });
  return ok(settingsOut(saved));
});
