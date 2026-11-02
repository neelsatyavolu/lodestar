import { fail, handle, ok } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { deleteLink } from "@/lib/db/inbound";
import { tripOwner, type TripCtx } from "@/lib/server/trip-owner";

// DELETE /api/connectors/flint/:id: disconnect from Lodestar's side. Flint's next delivery gets a 401 and stops.
export function DELETE(req: Request, ctx: TripCtx) {
  return handle(req, "disconnect", async () => {
    const who = await tripOwner(ctx);
    if (who instanceof Response) return who;
    return (await deleteLink(await getDb(), who.id, who.userId)) ? ok({}) : fail("That connection is already gone.", 404);
  });
}
