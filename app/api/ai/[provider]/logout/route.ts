import { fail, ok } from "@/lib/api";
import { isProvider } from "@/lib/ai/providers";
import { aiOwner, clearPkce, clearSession } from "@/lib/ai/session";

// POST /api/ai/:provider/logout: disconnect the provider, from the account too when signed in.
export async function POST(_req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isProvider(provider)) return fail("Unknown provider.", 404);
  await clearSession(provider, await aiOwner());
  await clearPkce(provider);
  return ok({ disconnected: provider });
}
