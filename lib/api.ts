import { NextResponse } from "next/server";
import { getSession } from "./auth";

/** JSON helpers for the API routes the app screen calls. */

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function noContent() {
  return new NextResponse(null, { status: 204 });
}

/** The middleware already turns away anonymous calls; this is the belt to its braces. */
export async function requireApiSession() {
  const s = await getSession();
  if (!s) throw new ApiError("Unauthorized", 401);
  return s;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Wraps a handler so thrown errors become JSON the app screen can show. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e: unknown) {
      if (e instanceof ApiError) return fail(e.message, e.status);
      const code = (e as { code?: string })?.code;
      if (code === "P2003") return fail("That record points at a client or appointment that no longer exists.", 409);
      if (code === "P2025") return fail("Not found.", 404);
      const message = e instanceof Error ? e.message : String(e);
      console.error("api error:", message);
      return fail(message || "Something went wrong.", 500);
    }
  };
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const v = await req.json();
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    throw new ApiError("The request body was not valid JSON.");
  }
}
