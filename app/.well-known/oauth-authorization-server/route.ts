import { metadataCorsOptionsRequestHandler } from "mcp-handler";
import { authServerMetadata, CORS } from "@/lib/oauth/metadata";
import { env } from "@/lib/server/env";

// RFC 8414: where agents find the authorize, token and registration endpoints.
export function GET() {
  return Response.json(authServerMetadata(env().APP_URL), { headers: { ...CORS, "cache-control": "public, max-age=3600" } });
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
