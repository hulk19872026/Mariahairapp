import { PrismaClient } from "@prisma/client";

/**
 * One Prisma client for the whole process. In development Next.js reloads
 * modules on every edit, which would otherwise open a fresh connection pool
 * each time; caching the client on `globalThis` keeps it to one.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
