import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { get as httpsGet } from "node:https";
import type { LookupFunction } from "node:net";
import { z } from "zod";
import { getClient, putClient, type OAuthClient } from "../db/agent-auth";
import type { Queryable } from "../db/client";
import { isBlockedAddress } from "./ip";
import { validRedirect } from "./redirect";

// Finding the client an authorization request names. A uuid is a client that
// registered here (RFC 7591). An https URL is a Client ID Metadata Document:
// the client describes itself at that address, which is fetched (carefully)
// and cached for a day.

const DOC_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_DOC_BYTES = 64 * 1024;

const Uuid = z.uuid();

export const ClientName = z.string().trim().min(1).max(80);
export const RedirectUris = z.array(z.string().refine(validRedirect, "That redirect URI isn't allowed.")).min(1).max(10);

/** What a client may send to /api/oauth/register. Unknown fields are ignored, as RFC 7591 asks. */
export const RegistrationSchema = z.object({
  client_name: ClientName.optional(),
  redirect_uris: RedirectUris,
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
});

const MetadataDocSchema = z.object({ client_id: z.string(), client_name: ClientName.optional(), redirect_uris: RedirectUris });

/** Whether a client_id is a URL this server would fetch: https, a real host name, default port, no credentials or fragment. */
export function metadataUrl(clientId: string): URL | null {
  if (clientId.length > 500) return null;
  let u: URL;
  try {
    u = new URL(clientId);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.port || u.username || u.password || u.hash || u.pathname === "/") return null;
  // An IP literal or single-label host is never a client's public metadata address.
  if (!u.hostname.includes(".") || /^[\d.]+$/.test(u.hostname) || u.hostname.startsWith("[")) return null;
  return u;
}

export class ClientError extends Error {}

/** A DNS lookup for the request itself that refuses private addresses, so the address checked is the address connected to (no rebinding). */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((a) => isBlockedAddress(a.address))) return callback(new ClientError("The client's address can't be reached."), "", 4);
    if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

/** GETs the document over https: no redirects, a short timeout, and the body capped as it streams. */
function getDoc(url: URL): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpsGet(url, { lookup: guardedLookup, headers: { accept: "application/json" }, timeout: FETCH_TIMEOUT_MS }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new ClientError("The client's metadata document couldn't be loaded."));
      }
      let size = 0;
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_DOC_BYTES) {
          req.destroy();
          return reject(new ClientError("The client's metadata document is too large."));
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", () => reject(new ClientError("The client's metadata document couldn't be loaded.")));
    });
    req.on("timeout", () => req.destroy(new ClientError("The client's metadata document couldn't be loaded.")));
    req.on("error", (err) => reject(err instanceof ClientError ? err : new ClientError("The client's metadata document couldn't be loaded.")));
  });
}

async function fetchMetadataDoc(url: URL): Promise<{ name: string; redirectUris: string[] }> {
  const text = await getDoc(url);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ClientError("The client's metadata document isn't JSON.");
  }
  const doc = MetadataDocSchema.safeParse(json);
  if (!doc.success || doc.data.client_id !== url.href) throw new ClientError("The client's metadata document doesn't describe this client.");
  return { name: doc.data.client_name ?? url.hostname, redirectUris: doc.data.redirect_uris };
}

/** The client a request names, or null when there's no such client. Throws ClientError when a metadata document can't be used. */
export async function resolveClient(q: Queryable, clientId: string, now: number): Promise<OAuthClient | null> {
  if (Uuid.safeParse(clientId).success) {
    const c = await getClient(q, clientId);
    return c?.kind === "dcr" ? c : null;
  }
  const url = metadataUrl(clientId);
  if (!url) return null;
  const cached = await getClient(q, url.href);
  if (cached && cached.fetchedAt !== null && now - cached.fetchedAt < DOC_TTL_MS) return cached;
  const doc = await fetchMetadataDoc(url);
  return putClient(q, { id: url.href, name: doc.name, redirectUris: doc.redirectUris, kind: "cimd" }, now);
}
