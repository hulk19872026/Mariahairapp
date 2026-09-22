"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  MIN_PASSWORD,
  checkPassword,
  findUserByName,
  hashPassword,
  requireUser,
} from "@/lib/auth";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function changePasswordAction(formData: FormData) {
  const me = await requireUser();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!(await checkPassword(current, me.passwordHash))) redirect("/setup?error=current");
  if (next.length < MIN_PASSWORD) redirect("/setup?error=short");
  if (next !== confirm) redirect("/setup?error=match");

  await prisma.user.update({
    where: { id: me.id },
    data: { passwordHash: await hashPassword(next) },
  });
  redirect("/setup?ok=password");
}

export async function updateEmailAction(formData: FormData) {
  const me = await requireUser();
  const email = str(formData, "email");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect("/setup?error=email");
  await prisma.user.update({ where: { id: me.id }, data: { email } });
  redirect("/setup?ok=email");
}

export async function addUserAction(formData: FormData) {
  await requireUser();
  const username = str(formData, "username");
  const email = str(formData, "email");
  const password = String(formData.get("password") ?? "");

  if (!/^[A-Za-z0-9._-]{2,32}$/.test(username)) redirect("/setup?error=username");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect("/setup?error=email");
  if (password.length < MIN_PASSWORD) redirect("/setup?error=short");
  if (await findUserByName(username)) redirect("/setup?error=exists");

  await prisma.user.create({
    data: { username, email, passwordHash: await hashPassword(password) },
  });
  redirect("/setup?ok=added");
}

export async function removeUserAction(formData: FormData) {
  const me = await requireUser();
  const id = str(formData, "id");
  if (!id || id === me.id) redirect("/setup?error=self");
  await prisma.user.deleteMany({ where: { id } });
  redirect("/setup?ok=removed");
}

/** Lets one user set a new password for another who is locked out. */
export async function resetUserPasswordAction(formData: FormData) {
  const me = await requireUser();
  const id = str(formData, "id");
  const password = String(formData.get("password") ?? "");
  if (!id || id === me.id) redirect("/setup?error=self");
  if (password.length < MIN_PASSWORD) redirect("/setup?error=short");
  await prisma.user.update({
    where: { id },
    data: { passwordHash: await hashPassword(password) },
  });
  redirect("/setup?ok=reset");
}
