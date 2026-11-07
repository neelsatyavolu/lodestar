import { beforeEach, describe, expect, it } from "vitest";
import { createPgliteDb, type Db } from "../db/client";
import { getJourney } from "../db/journeys";
import { migrate } from "../db/schema";
import { insertUser } from "../db/users";
import { addItems, createTrip } from "../server/plan-ops";
import { fileItems, ingestMail, type IncomingMail } from "./ingest";
import { DraftItemSchema } from "./types";

let db: Db;
const ada = "00000000-0000-4000-8000-000000000001";
const NOW = Date.UTC(2026, 10, 5);

beforeEach(async () => {
  db = await createPgliteDb();
  await migrate(db);
  await insertUser(db, { id: ada, email: "ada@example.com", passwordHash: "x", createdAt: 1 });
});

const html = (lines: string[]) => lines.map((l) => `<p>${l.replace(/&/g, "&amp;")}</p>`).join("");
const resy = (id: string, time = "7:00pm"): IncomingMail => ({
  source: "forward",
  messageId: id,
  from: "Traveller <ada@example.com>",
  subject: "Fwd: Your reservation at Penca is confirmed",
  text: null,
  html: html([
    "Reservation booked.", "Penca", `Sat, Nov. 21 at ${time}`, "4 Guests, Dining Room", "Manage Reservation",
    "Penca", "50 E Broadway Blvd", "Tucson, AZ 85701", "Get Directions", "+1 520-203-7681", "https://www.pencarestaurante.com",
    "This is a servicing communication sent by Resy Network Inc.",
  ]),
});

async function tucsonWithPenca(over: Record<string, unknown> = {}) {
  const tripId = await createTrip(db, ada, { destination: "Tucson", startDate: "2026-11-21", endDate: "2026-11-26", travelers: 4, tripType: "family" }, "manual");
  const draft = DraftItemSchema.parse({ kind: "dining", status: "planned", title: "Dinner at Penca", startDate: "2026-11-21", startTime: "19:30", details: { note: "Get the mole", placeId: "g:abc", lat: 32.22, lng: -110.97, reserve: true, bookBy: "2026-11-10" }, ...over });
  const [stopId] = await addItems(db, ada, tripId, [draft], "manual");
  return { tripId, stopId };
}

describe("a forwarded restaurant confirmation", () => {
  it("books the stop already in the itinerary instead of adding a second one", async () => {
    const { tripId, stopId } = await tucsonWithPenca();
    expect(await ingestMail(db, ada, resy("m1"), NOW)).toEqual({ status: "parsed", items: 1, journeyId: tripId });

    const trip = await getJourney(db, ada, tripId);
    const dining = trip!.items.filter((i) => i.kind === "dining");
    expect(dining).toHaveLength(1);
    expect(dining[0]).toMatchObject({ id: stopId, title: "Dinner at Penca", status: "booked", startTime: "19:00", place: "Tucson" });
    // Its note and map pin stay; the booking's facts arrive; it leaves To book.
    expect(dining[0].details).toEqual({ note: "Get the mole", placeId: "g:abc", lat: 32.22, lng: -110.97, provider: "Resy", guests: 4, address: "50 E Broadway Blvd, Tucson, AZ 85701", phone: "+1 520-203-7681", url: "https://www.pencarestaurante.com" });
  });

  it("updates the same stop when the time changes later", async () => {
    const { tripId, stopId } = await tucsonWithPenca();
    await ingestMail(db, ada, resy("m1"), NOW);
    await ingestMail(db, ada, resy("m2", "8:15pm"), NOW);
    const dining = (await getJourney(db, ada, tripId))!.items.filter((i) => i.kind === "dining");
    expect(dining.map((i) => [i.id, i.startTime])).toEqual([[stopId, "20:15"]]);
  });

  it("files into the trip on its own when nothing is planned there yet", async () => {
    const tripId = await createTrip(db, ada, { destination: "Tucson", startDate: "2026-11-21", endDate: "2026-11-26", travelers: null, tripType: null }, "manual");
    await ingestMail(db, ada, resy("m1"), NOW);
    const dining = (await getJourney(db, ada, tripId))!.items.filter((i) => i.kind === "dining");
    expect(dining).toMatchObject([{ title: "Penca", status: "booked", startTime: "19:00", source: "email" }]);
  });

  it("leaves a stop alone when it's a different restaurant", async () => {
    const { tripId } = await tucsonWithPenca({ title: "5 Points" });
    await ingestMail(db, ada, resy("m1"), NOW);
    const titles = (await getJourney(db, ada, tripId))!.items.map((i) => `${i.title}:${i.status}`).sort();
    expect(titles).toEqual(["5 Points:planned", "Penca:booked"]);
  });

  it("gives each booking its own stop when one email holds two tables at the same place", async () => {
    const { tripId, stopId } = await tucsonWithPenca();
    const table = (time: string, confirmation: string) => DraftItemSchema.parse({ kind: "dining", title: "Penca", startDate: "2026-11-21", startTime: time, confirmation });
    await fileItems(db, ada, [table("12:00", "AAA1"), table("19:00", "BBB2")], "email", NOW);
    const dining = (await getJourney(db, ada, tripId))!.items.filter((i) => i.kind === "dining");
    expect(dining.map((i) => i.confirmation).sort()).toEqual(["AAA1", "BBB2"]);
    expect(dining.find((i) => i.id === stopId)?.status).toBe("booked");
  });

  it("keeps the confirmation key when a later update leaves the number out", async () => {
    const { tripId, stopId } = await tucsonWithPenca();
    const table = (time: string, confirmation: string | null, startDate = "2026-11-21") => DraftItemSchema.parse({ kind: "dining", title: "Penca", startDate, startTime: time, confirmation });
    await fileItems(db, ada, [table("19:00", "AAA1")], "email", NOW);
    await fileItems(db, ada, [table("20:00", null)], "email", NOW);
    // Moved to the next night, with the number again: still the same stop.
    await fileItems(db, ada, [table("19:00", "AAA1", "2026-11-22")], "email", NOW);
    const dining = (await getJourney(db, ada, tripId))!.items.filter((i) => i.kind === "dining");
    expect(dining.map((i) => [i.id, i.startDate, i.confirmation])).toEqual([[stopId, "2026-11-22", "AAA1"]]);
  });
});
