import { clearSession } from "@/lib/auth";
import { noContent } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST() {
  await clearSession();
  return noContent();
}
