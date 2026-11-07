import { metadataCorsOptionsRequestHandler } from "mcp-handler";
import { getDb } from "@/lib/db/client";
import { grantOAuth, refreshGrant, takeCode, type TokenPair } from "@/lib/db/agent-auth";
import { ipKey } from "@/lib/server/auth";
import { allow } from "@/lib/server/limits";
import { resolveClient } from "@/lib/oauth/clients";
import { CORS, oauthError, SCOPE } from "@/lib/oauth/metadata";
import { verifyPkce } from "@/lib/oauth/tokens";

const MAX_BODY = 8_000;

const pairResponse = (p: TokenPair) =>
  Response.json(
    { access_token: p.accessToken, token_type: "Bearer", expires_in: p.expiresIn, refresh_token: p.refreshToken, scope: SCOPE },
    { headers: { ...CORS, "cache-control": "no-store", pragma: "no-cache" } },
  );

// POST /api/oauth/token (form-encoded): trade an authorization code (with its
// PKCE verifier) or a refresh token for a fresh access + refresh token pair.
export async function POST(req: Request) {
  if (!(await allow("oauthToken", ipKey(req)))) return oauthError("too_many_requests", "Too many requests. Try again later.", 429);
  if (!(req.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded")) return oauthError("invalid_request", "Send the request form-encoded.");
  const text = await req.text();
  if (text.length > MAX_BODY) return oauthError("invalid_request", "The request is too large.");
  const form = new URLSearchParams(text);
  const field = (k: string) => form.get(k) ?? "";
  // Public clients identify themselves with client_id; a secret sent by a client registered without one is ignored.
  const clientId = field("client_id");
  if (!clientId) return oauthError("invalid_client", "Send client_id.", 401);
  const db = await getDb();
  const now = Date.now();

  switch (field("grant_type")) {
    case "authorization_code": {
      const code = await takeCode(db, field("code"), now);
      if (!code || code.clientId !== clientId) return oauthError("invalid_grant", "That code is invalid, expired or already used.");
      if (field("redirect_uri") && field("redirect_uri") !== code.redirectUri) return oauthError("invalid_grant", "redirect_uri doesn't match the authorization request.");
      if (!verifyPkce(field("code_verifier"), code.challenge)) return oauthError("invalid_grant", "The code_verifier doesn't match.");
      const client = await resolveClient(db, clientId, now).catch(() => null);
      if (!client) return oauthError("invalid_client", "Unknown client.", 401);
      return pairResponse(await grantOAuth(db, code.userId, { id: client.id, name: client.name }, now));
    }
    case "refresh_token": {
      const result = await db.transaction((tx) => refreshGrant(tx, field("refresh_token"), clientId, now));
      if (!result.ok) return oauthError("invalid_grant", result.reason === "reused" ? "That refresh token was already used, so this connection was revoked. Connect again." : "That refresh token is invalid or expired.");
      return pairResponse(result.pair);
    }
    default:
      return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
  }
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
