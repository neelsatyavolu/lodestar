import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { FaresError } from "./fares";

// One response envelope for every JSON route: {ok: true, data} or {ok: false, error}.

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(error: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

export function fromError(err: unknown, what: string): NextResponse {
  if (err instanceof FaresError) return fail(err.message, err.status >= 500 ? err.status : 400);
  if (err instanceof z.ZodError) return fail(err.issues[0]?.message ?? "Invalid request.", 400);
  console.error(`[api] ${what} failed:`, err instanceof Error ? err.message : err);
  return fail(`The ${what} failed. Try again.`, 500);
}

export async function readJson(req: Request, maxBytes = 32_000): Promise<unknown> {
  if (Number(req.headers.get("content-length") ?? 0) > maxBytes) throw new FaresError("Request is too large.", 413);
  const text = await req.text();
  if (text.length > maxBytes) throw new FaresError("Request is too large.", 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new FaresError("Request body is not JSON.", 400);
  }
}

// Fixed-window limiter per client IP and route. In-memory: good for one
// instance; swap for a shared store before scaling out.
const windows = new Map<string, { start: number; count: number }>();
const WINDOW_MS = 60_000;
const MAX_TRACKED = 10_000;

/** Prefer the platform-set client IP (Vercel and most proxies set x-real-ip). */
export function clientIp(req: Request): string {
  return req.headers.get("x-real-ip")?.trim() || req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "local";
}

export function rateLimited(req: Request, route: string, perMinute: number): NextResponse | null {
  const now = Date.now();
  const k = `${route}:${clientIp(req)}`;
  const w = windows.get(k);
  if (!w || now - w.start > WINDOW_MS) {
    windows.delete(k);
    windows.set(k, { start: now, count: 1 });
    // Map order is insertion order, so the first entries are the oldest windows.
    for (const key of windows.keys()) {
      if (windows.size <= MAX_TRACKED) break;
      windows.delete(key);
    }
    return null;
  }
  if (w.count >= perMinute) return fail("Too many requests. Wait a minute and try again.", 429);
  windows.set(k, { ...w, count: w.count + 1 });
  return null;
}
