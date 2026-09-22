import { promises as fs } from "node:fs";
import path from "node:path";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * The salon manager itself: app.html at the repository root, served as the
 * home page once signed in. It talks to the /api routes from there.
 */
let cached: string | null = null;

async function page(): Promise<string> {
  if (cached && process.env.NODE_ENV === "production") return cached;
  cached = await fs.readFile(path.join(process.cwd(), "app.html"), "utf8");
  return cached;
}

export async function GET() {
  if (!(await getSession())) redirect("/login");
  return new Response(await page(), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
