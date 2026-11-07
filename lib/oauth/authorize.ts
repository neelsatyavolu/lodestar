import type { OAuthClient } from "../db/agent-auth";
import type { Queryable } from "../db/client";
import { ClientError, resolveClient } from "./clients";
import { issuer, SCOPE, validResource } from "./metadata";
import { matchRedirect } from "./redirect";
import { isChallenge } from "./tokens";

// Checking an authorization request (RFC 6749 §4.1.1 with PKCE). Until the
// client and redirect URI are known good, problems are shown on the page;
// after that they go back to the client as an error redirect.

export type AuthorizeParams = Partial<Record<"response_type" | "client_id" | "redirect_uri" | "code_challenge" | "code_challenge_method" | "state" | "scope" | "resource", string>>;

export type AuthorizeRequest = { client: OAuthClient; redirectUri: string; challenge: string; state: string | null; resource: string | null };

export type Checked = { kind: "ok"; request: AuthorizeRequest } | { kind: "show"; message: string } | { kind: "redirect"; url: string };

/** Where the client is sent back, with the response parameters and `iss` (RFC 9207). */
export function backToClient(redirectUri: string, params: Record<string, string | null>, origin: string): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== null) url.searchParams.set(k, v);
  url.searchParams.set("iss", issuer(origin));
  return url.toString();
}

/** Reads a single value from search params or form data, ignoring repeats (a repeated parameter is an error). */
export function single(get: (k: string) => string[] | undefined, keys: readonly string[]): AuthorizeParams & { repeated: boolean } {
  const out: AuthorizeParams & { repeated: boolean } = { repeated: false };
  for (const k of keys) {
    const v = get(k);
    if (!v?.length) continue;
    if (v.length > 1) out.repeated = true;
    out[k as keyof AuthorizeParams] = v[0];
  }
  return out;
}

export const PARAM_KEYS = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"] as const;

export async function checkAuthorize(q: Queryable, p: AuthorizeParams & { repeated?: boolean }, origin: string, now: number): Promise<Checked> {
  if (!p.client_id) return { kind: "show", message: "The app didn't say who it is (no client_id)." };
  let client: OAuthClient | null;
  try {
    client = await resolveClient(q, p.client_id, now);
  } catch (err) {
    return { kind: "show", message: err instanceof ClientError ? err.message : "The app couldn't be checked. Try again." };
  }
  if (!client) return { kind: "show", message: "Lodestar doesn't know this app. Add it again from the app you're connecting." };
  if (!p.redirect_uri) return { kind: "show", message: "The app didn't say where to return (no redirect_uri)." };
  const redirectUri = matchRedirect(p.redirect_uri, client.redirectUris);
  if (!redirectUri) return { kind: "show", message: "The app asked to return to an address it didn't register." };

  const state = p.state ?? null;
  const fail = (error: string, description: string): Checked => ({ kind: "redirect", url: backToClient(redirectUri, { error, error_description: description, state }, origin) });
  if (p.repeated) return fail("invalid_request", "A parameter was repeated.");
  if (p.response_type !== "code") return fail("unsupported_response_type", "Only the authorization code flow is supported.");
  if (!p.code_challenge || !isChallenge(p.code_challenge)) return fail("invalid_request", "PKCE is required: send a code_challenge.");
  if (p.code_challenge_method !== "S256") return fail("invalid_request", "Use code_challenge_method S256.");
  if (p.scope && !p.scope.split(" ").every((s) => s === SCOPE || s === "")) return fail("invalid_scope", `The only scope is "${SCOPE}".`);
  const resource = p.resource ?? null;
  if (!validResource(resource, origin)) return fail("invalid_target", "That resource isn't served here.");
  return { kind: "ok", request: { client, redirectUri, challenge: p.code_challenge, state, resource } };
}
