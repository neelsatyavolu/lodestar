import { connection } from "next/server";
import { fail, fromError, ok } from "@/lib/api";
import { PlacesError } from "@/lib/places/google";
import { google, placesUser } from "@/lib/server/places";

// GET /api/places/details?id=g:<place id>&session=: rating, hours, photos and the rest, fetched live.
export async function GET(req: Request) {
  await connection();
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id") ?? "";
    const g = google();
    if (!g || !/^g:[A-Za-z0-9_-]{10,300}$/.test(id)) return fail("No details for this place.", 404);
    const who = await placesUser();
    if (who instanceof Response) return who;
    const session = (url.searchParams.get("session") ?? "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 64) || null;
    return ok({ place: await g.details(id.slice(2), session) }, { headers: { "cache-control": "private, max-age=300" } });
  } catch (err) {
    if (err instanceof PlacesError) return fail(err.message, err.status);
    return fromError(err, "place details");
  }
}
