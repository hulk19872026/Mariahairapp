"use server";

import { redirect } from "next/navigation";
import { clearSession, createSession, ensureDefaultUser, verifyLogin } from "@/lib/auth";

/** Only allow redirects back into this site, never to another host. */
function safeNext(v: FormDataEntryValue | null): string {
  const s = String(v ?? "");
  return s.startsWith("/") && !s.startsWith("//") ? s : "";
}

export async function loginAction(formData: FormData) {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  await ensureDefaultUser();
  const user = await verifyLogin(username, password);
  if (!user) {
    redirect(`/login?error=1${next ? `&next=${encodeURIComponent(next)}` : ""}`);
  }
  await createSession(user);
  redirect(next || "/");
}

export async function logoutAction() {
  await clearSession();
  redirect("/login");
}
