"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { findUserByNameOrEmail, hashPassword, tempPassword } from "@/lib/auth";
import { mailConfigured, sendMail } from "@/lib/mail";
import { getSettings } from "@/lib/automation";

/**
 * Sets a fresh temporary password on the account and emails it. The old
 * password is only replaced once the email has actually gone out, so a mail
 * failure never locks anyone out.
 */
export async function forgotAction(formData: FormData) {
  const who = String(formData.get("who") ?? "").trim();
  if (!who) redirect("/forgot?error=empty");

  if (!mailConfigured() && process.env.DRY_RUN !== "true") redirect("/forgot?error=mail");

  const user = await findUserByNameOrEmail(who);
  // don't reveal which usernames exist
  if (!user) redirect("/forgot?sent=1");
  if (!user.email) redirect("/forgot?error=noemail");

  const st = await getSettings();
  const plain = tempPassword();
  const r = await sendMail({
    to: user.email,
    subject: `Your ${st.bizName || "Chair & Comb"} password`,
    text:
      `Hi ${user.username},\n\n` +
      `Here is a new password for your ${st.bizName || "Chair & Comb"} account:\n\n` +
      `Username: ${user.username}\nPassword: ${plain}\n\n` +
      `Sign in with it, then pick a new password of your own under Setup.\n\n` +
      `If you didn't ask for this, you can ignore this email — nothing else has changed.`,
  });
  if (!r.ok) {
    console.error("forgot-password mail failed:", r.error);
    redirect("/forgot?error=mail");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(plain) },
  });
  redirect("/login?reset=1");
}
