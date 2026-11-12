import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// The short-lived cookie that carries one Xanom sign-in from /api/xanom/start to the callback:
// the state, PKCE verifier and nonce sent to accounts.xanom.co, plus what to do on return.
// It is signed, so the browser can hold it without being able to change it.

export const STATE_COOKIE = "ls_xanom";
export const STATE_PATH = "/api/xanom";
export const STATE_TTL_MS = 10 * 60_000;

export const INTENTS = ["signin", "link", "convert"] as const;
export type Intent = (typeof INTENTS)[number];
export const PLATFORMS = ["web", "ios"] as const;
export type Platform = (typeof PLATFORMS)[number];

const FlowSchema = z.object({
  state: z.string().min(20).max(100),
  verifier: z.string().min(43).max(128),
  nonce: z.string().min(20).max(100),
  intent: z.enum(INTENTS),
  platform: z.enum(PLATFORMS),
  returnTo: z.string().max(2000),
  /** The account that asked to link or convert; the callback refuses any other. */
  userId: z.uuid().nullable(),
  /** iOS only: the SHA-256 of the app's secret, which it must show to redeem the ticket. */
  challenge: z.string().max(100).nullable(),
  expiresAt: z.number(),
});
export type Flow = z.infer<typeof FlowSchema>;

export const flowKey = (secret: string): Buffer => Buffer.from(hkdfSync("sha256", secret, "lodestar", "xanom-flow", 32));

const mac = (key: Buffer, value: string) => createHmac("sha256", key).update(value).digest("base64url");

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");

/** base64url(SHA-256(value)): the PKCE S256 challenge, also used for the iOS ticket binding. */
export const s256 = (value: string): string => createHash("sha256").update(value).digest("base64url");

export function newFlow(input: Omit<Flow, "state" | "verifier" | "nonce" | "expiresAt">, now: number): Flow {
  return { ...input, state: randomToken(), verifier: randomToken(48), nonce: randomToken(), expiresAt: now + STATE_TTL_MS };
}

function seal(key: Buffer, kind: string, value: object): string {
  const body = Buffer.from(JSON.stringify({ ...value, kind })).toString("base64url");
  return `${body}.${mac(key, body)}`;
}

function open<T extends { expiresAt: number }>(key: Buffer, kind: string, value: string | undefined, schema: z.ZodType<T>, now: number): T | null {
  if (!value || value.length > 4000) return null;
  const [body, given, extra] = value.split(".");
  if (!body || !given || extra !== undefined) return null;
  if (!safeEqual(given, mac(key, body))) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if ((parsed as { kind?: unknown } | null)?.kind !== kind) return null;
  const result = schema.safeParse(parsed);
  return result.success && now < result.data.expiresAt ? result.data : null;
}

export const sealFlow = (key: Buffer, flow: Flow): string => seal(key, "flow", flow);

/** The flow a cookie holds, or null if it is missing, forged, malformed or expired. */
export const openFlow = (key: Buffer, value: string | undefined, now: number): Flow | null => open(key, "flow", value, FlowSchema, now);

// iOS link and convert: the app asks (with its own session) for a start link that names the
// account, because the sign-in sheet's browser doesn't share the app's cookies.
const IosStartSchema = z.object({
  userId: z.uuid(),
  intent: z.enum(["link", "convert"]),
  challenge: z.string().max(100),
  expiresAt: z.number(),
});
export type IosStart = z.infer<typeof IosStartSchema>;
export const IOS_START_TTL_MS = 5 * 60_000;

export const sealIosStart = (key: Buffer, start: IosStart): string => seal(key, "ios-start", start);
export const openIosStart = (key: Buffer, value: string | undefined, now: number): IosStart | null => open(key, "ios-start", value, IosStartSchema, now);

/** What the app sends as its challenge: base64url SHA-256, 43 characters. */
export const validChallenge = (value: string | null): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
