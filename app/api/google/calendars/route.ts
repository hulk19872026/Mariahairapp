import { ApiError, handle, ok, readJson, requireApiSession } from "@/lib/api";
import { chooseCalendar, googleStatus, listCalendars } from "@/lib/google";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** The calendars she can write to, for "Change calendar". */
export const GET = handle(async () => {
  await requireApiSession();
  return ok(await listCalendars());
});

export const POST = handle(async (req: Request) => {
  await requireApiSession();
  const { id } = await readJson(req);
  if (!id) throw new ApiError("Pick a calendar.");
  await chooseCalendar(String(id));
  return ok(await googleStatus());
});
