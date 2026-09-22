import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { integrationStatus } from "@/lib/senders";
import { storageName } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Used by Railway's healthcheck; reports 503 when the database is unreachable. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      ok: true,
      db: "up",
      storage: storageName(),
      ...integrationStatus(),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, db: "down", error: message }, { status: 503 });
  }
}
