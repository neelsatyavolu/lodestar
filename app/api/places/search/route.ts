import { connection } from "next/server";
import { fail, fromError, ok } from "@/lib/api";
import { PlacesError } from "@/lib/places/google";
import { osmSearch } from "@/lib/places/osm";
import { google, LatLngQuery, placesUser } from "@/lib/server/places";

// GET /api/places/search?q=&lat=&lng=&session=: suggestions for "Add a place", near the trip.
export async function GET(req: Request) {
  await connection();
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
    if (q.length < 2) return ok({ suggestions: [], provider: google() ? "google" : "osm" });
    const who = await placesUser();
    if (who instanceof Response) return who;
    const near = LatLngQuery(url);
    const session = (url.searchParams.get("session") ?? "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 64) || crypto.randomUUID();
    const g = google();
    const suggestions = g ? await g.autocomplete(q, near, session) : await osmSearch(q, near);
    return ok({ suggestions, provider: g ? "google" : "osm" });
  } catch (err) {
    if (err instanceof PlacesError) return fail(err.message, err.status);
    return fromError(err, "place search");
  }
}
