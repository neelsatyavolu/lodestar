import { randomUUID } from "node:crypto";
import { metadataCorsOptionsRequestHandler } from "mcp-handler";
import { getDb } from "@/lib/db/client";
import { putClient } from "@/lib/db/agent-auth";
import { ipKey } from "@/lib/server/auth";
import { allow } from "@/lib/server/limits";
import { RegistrationSchema } from "@/lib/oauth/clients";
import { CORS, oauthError } from "@/lib/oauth/metadata";

const MAX_BODY = 16_000;

// POST /api/oauth/register: dynamic client registration (RFC 7591) for agents
// like Claude and ChatGPT. Clients are public: no secret, PKCE on every
// authorization. A requested auth method other than "none" is answered with "none".
export async function POST(req: Request) {
  if (!(await allow("oauthRegister", ipKey(req)))) return oauthError("too_many_requests", "Too many registrations. Try again later.", 429);
  const text = await req.text();
  if (text.length > MAX_BODY) return oauthError("invalid_client_metadata", "The registration is too large.");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return oauthError("invalid_client_metadata", "The registration isn't JSON.");
  }
  const parsed = RegistrationSchema.safeParse(body);
  if (!parsed.success) {
    const redirect = parsed.error.issues.some((i) => i.path[0] === "redirect_uris");
    return oauthError(redirect ? "invalid_redirect_uri" : "invalid_client_metadata", parsed.error.issues[0]?.message ?? "Invalid registration.");
  }
  const grants = parsed.data.grant_types ?? ["authorization_code"];
  if (!grants.includes("authorization_code") || grants.some((g) => g !== "authorization_code" && g !== "refresh_token")) return oauthError("invalid_client_metadata", "Only authorization_code and refresh_token grants are supported.");
  const now = Date.now();
  const client = await putClient(await getDb(), { id: randomUUID(), name: parsed.data.client_name ?? "An AI agent", redirectUris: parsed.data.redirect_uris, kind: "dcr" }, now);
  return Response.json(
    {
      client_id: client.id,
      client_id_issued_at: Math.floor(now / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "trips",
    },
    { status: 201, headers: { ...CORS, "cache-control": "no-store" } },
  );
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
