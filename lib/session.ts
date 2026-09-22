import { SignJWT, jwtVerify } from "jose";

/**
 * The signed session cookie. Only `jose` is used here so this file can also
 * run inside the Edge middleware, which has no access to Prisma or bcrypt.
 */

export const SESSION_COOKIE = "cc_session";
export const SESSION_DAYS = 30;

export type Session = { userId: string; username: string };

function secret(): Uint8Array {
  const raw =
    process.env.AUTH_SECRET ||
    process.env.CRON_SECRET ||
    process.env.DATABASE_URL ||
    "chair-and-comb-development-secret";
  return new TextEncoder().encode(raw);
}

export async function signSession(s: Session): Promise<string> {
  return new SignJWT({ username: s.username })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(s.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub || typeof payload.username !== "string") return null;
    return { userId: payload.sub, username: payload.username };
  } catch {
    return null;
  }
}
