import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { XanomConfig } from "../xanom/oidc";
import { flowKey, sealFlow, STATE_COOKIE, STATE_PATH, STATE_TTL_MS, type Flow, type Platform } from "../xanom/state";
import type { XanomErrorCode } from "../xanom/messages";
import { env } from "./env";

let key: Buffer | null = null;
export const xanomKey = (): Buffer => (key ??= flowKey(env().LODESTAR_SECRET));

/** The client settings, or null while XANOM_* isn't configured. */
export function xanomConfig(): XanomConfig | null {
  const e = env();
  if (!e.XANOM_ISSUER || !e.XANOM_CLIENT_ID || !e.XANOM_CLIENT_SECRET) return null;
  return { issuer: e.XANOM_ISSUER, clientId: e.XANOM_CLIENT_ID, clientSecret: e.XANOM_CLIENT_SECRET };
}

export const appUrl = (): string => env().APP_URL;

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: STATE_PATH,
};

export async function writeFlow(flow: Flow): Promise<void> {
  (await cookies()).set(STATE_COOKIE, sealFlow(xanomKey(), flow), { ...cookieOptions, maxAge: STATE_TTL_MS / 1000 });
}

export async function readFlowCookie(): Promise<string | undefined> {
  return (await cookies()).get(STATE_COOKIE)?.value;
}

export async function clearFlow(): Promise<void> {
  (await cookies()).delete({ name: STATE_COOKIE, path: STATE_PATH });
}

export const IOS_CALLBACK = "lodestar://xanom";

/** Where a failed flow lands: the sign-in dialog on the web, the app on iOS. */
export function failRedirect(code: XanomErrorCode, platform: Platform): NextResponse {
  const target = platform === "ios" ? `${IOS_CALLBACK}?error=${code}` : new URL(`/?xanom_error=${code}`, appUrl()).toString();
  return NextResponse.redirect(target, { status: 303, headers: { "cache-control": "no-store" } });
}

export function goTo(target: string): NextResponse {
  return NextResponse.redirect(target, { status: 303, headers: { "cache-control": "no-store" } });
}
