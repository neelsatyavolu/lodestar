import { fail, ok, rateLimited } from "@/lib/api";
import { buildAuthorizeUrl, generatePkce, isProvider } from "@/lib/ai/providers";
import { deviceId, writePkce } from "@/lib/ai/session";

// POST /api/ai/:provider/start: begin sign-in. The browser opens authorizeUrl,
// then pastes back the callback link (ChatGPT) or code (Grok).
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const limited = rateLimited(req, "ai-start", 10);
  if (limited) return limited;
  const { provider } = await params;
  if (!isProvider(provider)) return fail("Unknown provider.", 404);
  await deviceId();
  const { verifier, challenge, state } = generatePkce();
  await writePkce(provider, { verifier, state });
  return ok({ authorizeUrl: buildAuthorizeUrl(provider, challenge, state) });
}
