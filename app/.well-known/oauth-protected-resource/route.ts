import { generateProtectedResourceMetadata, metadataCorsOptionsRequestHandler } from "mcp-handler";
import { issuer, resourceUrl, SCOPE } from "@/lib/oauth/metadata";
import { env } from "@/lib/server/env";

// RFC 9728: the MCP endpoint is protected by this same origin's authorization server.
// Served here and at /.well-known/oauth-protected-resource/api/mcp (the path-suffixed form).
export function GET() {
  const origin = env().APP_URL;
  const doc = generateProtectedResourceMetadata({ authServerUrls: [issuer(origin)], resourceUrl: resourceUrl(origin), additionalMetadata: { scopes_supported: [SCOPE], resource_name: "Lodestar Trips" } });
  return Response.json(doc, { headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=3600" } });
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
