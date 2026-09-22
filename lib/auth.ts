import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { prisma } from "./prisma";
import { SESSION_COOKIE, SESSION_DAYS, signSession, verifySession, type Session } from "./session";

/* -------------------------------------------------------------------------
   Passwords
   ------------------------------------------------------------------------- */

export const MIN_PASSWORD = 8;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function checkPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/** A readable temporary password, without look-alike characters. */
export function tempPassword(length = 10): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

/* -------------------------------------------------------------------------
   Users
   ------------------------------------------------------------------------- */

export const DEFAULT_USERNAME = "Maria";
const DEFAULT_PASSWORD = "maria1234";

/** Creates the first account when the table is empty, so the app can be entered. */
export async function ensureDefaultUser(): Promise<void> {
  const count = await prisma.user.count();
  if (count > 0) return;
  await prisma.user.create({
    data: {
      username: DEFAULT_USERNAME,
      email: process.env.ADMIN_EMAIL || "",
      passwordHash: await hashPassword(DEFAULT_PASSWORD),
    },
  });
}

export async function findUserByName(username: string): Promise<User | null> {
  const name = username.trim();
  if (!name) return null;
  return prisma.user.findFirst({ where: { username: { equals: name, mode: "insensitive" } } });
}

export async function findUserByNameOrEmail(who: string): Promise<User | null> {
  const s = who.trim();
  if (!s) return null;
  return prisma.user.findFirst({
    where: {
      OR: [
        { username: { equals: s, mode: "insensitive" } },
        { email: { equals: s, mode: "insensitive" } },
      ],
    },
  });
}

export async function verifyLogin(username: string, password: string): Promise<User | null> {
  const user = await findUserByName(username);
  if (!user) return null;
  return (await checkPassword(password, user.passwordHash)) ? user : null;
}

/* -------------------------------------------------------------------------
   Sessions
   ------------------------------------------------------------------------- */

export async function createSession(user: User): Promise<void> {
  const token = await signSession({ userId: user.id, username: user.username });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value);
}

/** The signed-in user, or a redirect to the login page. */
export async function requireUser(): Promise<User> {
  const s = await getSession();
  const user = s ? await prisma.user.findUnique({ where: { id: s.userId } }) : null;
  if (!user) redirect("/login");
  return user;
}
