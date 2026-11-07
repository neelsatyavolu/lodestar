// The addresses agents discover: this server is both the MCP resource and its
// own OAuth authorization server, on one origin.

export const SCOPE = "trips";
export const MCP_PATH = "/api/mcp";
export const RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource/api/mcp";

const trim = (origin: string) => origin.replace(/\/+$/, "");

export const issuer = (origin: string) => trim(origin);
export const resourceUrl = (origin: string) => `${trim(origin)}${MCP_PATH}`;

/** RFC 8414 authorization server metadata. */
export function authServerMetadata(origin: string) {
  const base = trim(origin);
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    scopes_supported: [SCOPE],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${base}/?agents=1`,
  };
}

/** Whether an RFC 8707 resource indicator names this server's MCP endpoint (or the whole origin). */
export function validResource(resource: string | null, origin: string): boolean {
  if (resource === null) return true;
  const r = resource.replace(/\/+$/, "");
  return r === resourceUrl(origin) || r === trim(origin);
}

export const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, authorization, mcp-protocol-version" };

/** An OAuth error response (RFC 6749 §5.2), never cached. */
export function oauthError(error: string, description: string, status = 400): Response {
  return Response.json({ error, error_description: description }, { status, headers: { ...CORS, "cache-control": "no-store" } });
}
