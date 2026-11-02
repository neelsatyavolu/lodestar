import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { fail } from "../api";
import { aiOwner, getActiveSession } from "../ai/session";
import { deriveKey, seal, unseal } from "../ai/seal";
import type { Provider, Tokens } from "../ai/providers";
import type { Queryable } from "../db/client";
import { ensureInboxToken, setInboxToken } from "../db/inbound";
import { env } from "./env";

// Server glue for the Trips organizer: keys for connector secrets and pairing
// codes, the forwarding address, and the traveller's AI session.

let sealKey: Buffer | null = null;
let codePepper: Buffer | null = null;
const secretKey = () => (sealKey ??= deriveKey(env().LODESTAR_SECRET, "connector-secrets"));
export const pairPepper = () => (codePepper ??= deriveKey(env().LODESTAR_SECRET, "connector-pair-codes"));

export const sealConnectorSecret = (connectionId: string, secret: string) => seal(secretKey(), secret, `flint:${connectionId}`);
export const openConnectorSecret = (connectionId: string, sealed: string) => unseal(secretKey(), sealed, `flint:${connectionId}`);

/** 24 lowercase base-36 characters (about 124 bits): the forwarding address's local part. */
export function newInboxToken(): string {
  return BigInt(`0x${randomBytes(16).toString("hex")}`).toString(36).padStart(25, "0").slice(-24);
}

/** The account's forwarding address, created on first use. Null when inbound mail isn't configured. */
export async function forwardingAddress(q: Queryable, userId: string, rotate = false): Promise<string | null> {
  const domain = env().INBOUND_DOMAIN;
  if (!domain) return null;
  if (rotate) {
    const token = newInboxToken();
    await setInboxToken(q, userId, token);
    return `${token}@${domain}`;
  }
  return `${await ensureInboxToken(q, userId, newInboxToken())}@${domain}`;
}

/** The traveller's AI tokens for a provider, or the response explaining why there are none. */
export async function aiTokens(provider: Provider): Promise<Tokens | Response> {
  const tokens = await getActiveSession(provider, await aiOwner());
  return tokens ?? fail(`Connect your ${provider === "codex" ? "ChatGPT" : "Grok"} account first.`, 401);
}

/** A rate-limit key for a connection or inbox, not tied to an IP (Flint and Resend send from many). */
export const senderKey = (kind: string, id: string) => createHmac("sha256", pairPepper()).update(`${kind}:${id}`).digest("base64url").slice(0, 32);
