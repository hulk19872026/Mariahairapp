import { ApiError, handle, ok, requireApiSession } from "@/lib/api";
import { importCustomers } from "@/lib/records-import";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Import a client list from a CSV (a Square customer export, or any sheet
 * with name / phone / email columns). Accepts a multipart `file` field or
 * the CSV text as the request body.
 */
export const POST = handle(async (req: Request) => {
  await requireApiSession();
  let text = "";
  const type = req.headers.get("content-type") || "";
  if (type.includes("multipart/form-data")) {
    const fd = await req.formData();
    const f = fd.get("file");
    if (!f || typeof f === "string") throw new ApiError("Attach a CSV file.");
    if (f.size > MAX_BYTES) throw new ApiError("That file is too large.");
    text = await f.text();
  } else {
    text = await req.text();
    if (text.length > MAX_BYTES) throw new ApiError("That file is too large.");
  }
  if (!text.trim()) throw new ApiError("The file is empty.");
  return ok(await importCustomers(text));
});
