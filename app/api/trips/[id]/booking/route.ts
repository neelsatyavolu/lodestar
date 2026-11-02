import { fail, handle, ok, readJson } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { clearBooking, setBooking } from "@/lib/db/trips";
import { ipKey } from "@/lib/server/auth";
import { allow } from "@/lib/server/limits";
import { tripOwner, type TripCtx } from "@/lib/server/trip-owner";
import { BookingSchema } from "@/lib/trips/booked";

// PUT /api/trips/:id/booking {tfs, seller, isAirline, fare, paid, changes, refunds}:
// mark the trip booked, so the daily check watches that fare against what was paid.
export function PUT(req: Request, ctx: TripCtx) {
  return handle(req, "booking save", async () => {
    const who = await tripOwner(ctx);
    if (who instanceof Response) return who;
    if (!(await allow("trips", ipKey(req)))) return fail("Too many changes. Try again in a few minutes.", 429);
    const trip = await setBooking(await getDb(), who.userId, who.id, BookingSchema.parse(await readJson(req)));
    return trip ? ok({ trip }) : fail("That itinerary isn't on this trip's shortlist.", 404);
  });
}

// DELETE /api/trips/:id/booking: back to watching the shortlist.
export function DELETE(req: Request, ctx: TripCtx) {
  return handle(req, "booking clear", async () => {
    const who = await tripOwner(ctx);
    if (who instanceof Response) return who;
    const trip = await clearBooking(await getDb(), who.userId, who.id);
    return trip ? ok({ trip }) : fail("That trip doesn't exist.", 404);
  });
}
