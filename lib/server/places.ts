import "server-only";
import { fail } from "../api";
import { googleClient, type GoogleClient } from "../places/google";
import { currentUserId } from "./auth";
import { env } from "./env";
import { senderKey } from "./journeys";
import { allow } from "./limits";

// The places provider for this server, and the gate every places route uses:
// signed in, and within the per-account limits (Google bills per call).

let client: GoogleClient | null | undefined;

/** Google when GOOGLE_PLACES_KEY is set, else null (OpenStreetMap search only). */
export function google(): GoogleClient | null {
  if (client === undefined) client = env().GOOGLE_PLACES_KEY ? googleClient(env().GOOGLE_PLACES_KEY!) : null;
  return client;
}

export async function placesUser(): Promise<string | Response> {
  const userId = await currentUserId();
  if (!userId) return fail("Sign in first.", 401);
  const key = senderKey("places", userId);
  if (!(await allow("places", key)) || !(await allow("placesDaily", key))) return fail("That's a lot of searching. Try again in a few minutes.", 429);
  return userId;
}

export const LatLngQuery = (url: URL) => {
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  return url.searchParams.has("lat") && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
};
