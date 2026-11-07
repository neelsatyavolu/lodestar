import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { INSTRUCTIONS, registerTripTools, verifyBearer } from "@/lib/mcp/server";
import { RESOURCE_METADATA_PATH, SCOPE } from "@/lib/oauth/metadata";
import { env } from "@/lib/server/env";

// The Trips MCP server (streamable HTTP, stateless). Agents sign in with
// OAuth or a personal token; an unauthenticated request gets a 401 that
// points at /.well-known/oauth-protected-resource/api/mcp.

const mcp = createMcpHandler(registerTripTools, { serverInfo: { name: "lodestar-trips", version: "1.0.0" }, instructions: INSTRUCTIONS });

const handler = (req: Request) =>
  withMcpAuth(mcp, verifyBearer, { required: true, requiredScopes: [SCOPE], resourceMetadataPath: RESOURCE_METADATA_PATH, resourceUrl: env().APP_URL })(req);

export { handler as GET, handler as POST, handler as DELETE };
