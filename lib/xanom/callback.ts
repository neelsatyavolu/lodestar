import type { JWTVerifyGetKey } from "jose";
import { exchangeCode, verifyIdToken, XanomError, type XanomConfig, type XanomIdentity } from "./oidc";
import { safeEqual, type Flow } from "./state";

export type CallbackResult = { ok: true; identity: XanomIdentity } | { ok: false; reason: "denied" | "expired" | "failed"; detail?: string };

/**
 * Checks what accounts.xanom.co sent back against the flow this browser started (state), then
 * exchanges the code (PKCE) and verifies the id_token (signature, iss, aud, exp, nonce).
 */
export async function finishCallback(input: {
  config: XanomConfig;
  appUrl: string;
  params: URLSearchParams;
  flow: Flow | null;
  jwks: JWTVerifyGetKey;
  now: number;
  fetcher?: typeof fetch;
}): Promise<CallbackResult> {
  const { params, flow } = input;
  if (!flow) return { ok: false, reason: "expired" };
  const state = params.get("state") ?? "";
  if (!safeEqual(state, flow.state)) return { ok: false, reason: "expired" };
  const error = params.get("error");
  if (error) return { ok: false, reason: error === "access_denied" || error === "login_required" ? "denied" : "failed", detail: error.slice(0, 60) };
  const code = params.get("code");
  if (!code || code.length > 500) return { ok: false, reason: "failed", detail: "no code" };
  try {
    const idToken = await exchangeCode(input.config, input.appUrl, code, flow.verifier, input.fetcher);
    return { ok: true, identity: await verifyIdToken(input.config, idToken, flow.nonce, input.jwks, input.now) };
  } catch (err) {
    return { ok: false, reason: "failed", detail: err instanceof XanomError ? err.message : err instanceof Error ? err.name : "unknown" };
  }
}
