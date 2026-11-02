import { connection, NextResponse } from "next/server";
import { fail, fromError } from "@/lib/api";
import { PlacesError } from "@/lib/places/google";
import { google, placesUser } from "@/lib/server/places";

// GET /api/places/photo?name=places/<id>/photos/<ref>&w=: redirects to Google's image, keeping the key on the server.
export async function GET(req: Request) {
  await connection();
  try {
    const url = new URL(req.url);
    const name = url.searchParams.get("name") ?? "";
    const g = google();
    if (!g || !/^places\/[A-Za-z0-9_-]{10,300}\/photos\/[A-Za-z0-9_-]{10,1000}$/.test(name)) return fail("No photo.", 404);
    const width = Math.min(1200, Math.max(100, Number(url.searchParams.get("w")) || 640));
    const who = await placesUser();
    if (who instanceof Response) return who;
    return NextResponse.redirect(await g.photoUri(name, width), { status: 302, headers: { "cache-control": "private, max-age=3000" } });
  } catch (err) {
    if (err instanceof PlacesError) return fail(err.message, err.status);
    return fromError(err, "photo");
  }
}
