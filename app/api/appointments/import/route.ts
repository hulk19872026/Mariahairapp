import { ApiError, handle, ok, requireApiSession } from "@/lib/api";
import { importAppointments } from "@/lib/appointments-import";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BYTES = 5 * 1024 * 1024;

/** Import appointments from a CSV. Accepts a multipart `file` field or the CSV as the body. */
export const POST = handle(async (req: Request) => {
  await requireApiSession();
  let text = "";
  if ((req.headers.get("content-type") || "").includes("multipart/form-data")) {
    const f = (await req.formData()).get("file");
    if (!f || typeof f === "string") throw new ApiError("Attach a CSV file.");
    if (f.size > MAX_BYTES) throw new ApiError("That file is too large.");
    text = await f.text();
  } else {
    text = await req.text();
    if (text.length > MAX_BYTES) throw new ApiError("That file is too large.");
  }
  if (!text.trim()) throw new ApiError("The file is empty.");
  return ok(await importAppointments(text));
});
