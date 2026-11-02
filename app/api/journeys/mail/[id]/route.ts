import { fail, handle, ok } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { deleteMail } from "@/lib/db/inbound";
import { tripOwner, type TripCtx } from "@/lib/server/trip-owner";

// DELETE /api/journeys/mail/:id: forget a forwarded email that's waiting or couldn't be read.
export function DELETE(req: Request, ctx: TripCtx) {
  return handle(req, "email delete", async () => {
    const who = await tripOwner(ctx);
    if (who instanceof Response) return who;
    return (await deleteMail(await getDb(), who.userId, who.id)) ? ok({}) : fail("That email is already gone.", 404);
  });
}
