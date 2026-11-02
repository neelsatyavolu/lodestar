import { Container } from "@cloudflare/containers";

// Only the Contrail web app may call the fares service: every request except
// /health must carry the shared FARES_TOKEN secret.

type Env = { FARES: DurableObjectNamespace<FaresContainer>; FARES_TOKEN: string };

export class FaresContainer extends Container<Env> {
  defaultPort = 8080;
  // Keep Chromium warm between searches; sleep after a quiet half hour.
  sleepAfter = "30m";
}

const encoder = new TextEncoder();

function sameSecret(given: string, expected: string): boolean {
  const a = encoder.encode(given);
  const b = encoder.encode(expected);
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const isHealth = pathname === "/health" && request.method === "GET";
    if (!isHealth) {
      if (!env.FARES_TOKEN) return Response.json({ detail: "Fares token not configured." }, { status: 500 });
      if (!sameSecret(request.headers.get("x-fares-token") ?? "", env.FARES_TOKEN)) {
        return Response.json({ detail: "Missing or wrong fares token." }, { status: 401 });
      }
    }
    // One named instance holds the shared browser and the seller-page cache.
    return env.FARES.getByName("fares").fetch(request);
  },
} satisfies ExportedHandler<Env>;
