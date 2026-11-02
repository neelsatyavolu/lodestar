import { beforeEach, describe, expect, it } from "vitest";
import { fileItems, htmlToText, ingestMail, mailBody } from "../journeys/ingest";
import { DraftItemSchema } from "../journeys/types";
import { createPgliteDb, type Db } from "./client";
import {
  deleteLink, deleteMail, ensureInboxToken, insertLink, insertMail, insertPairCode, linkSecret, listLinks, mailNeedingAttention, pendingMail, purgeStaleBodies, setInboxToken, takePairCode, touchLink, userForInbox, inboxToken,
} from "./inbound";
import { deleteJourney, deleteSuggestions, getJourney, listJourneys, updateItem, updateJourney, upsertItem, upsertJourney } from "./journeys";
import { migrate } from "./schema";
import { insertUser } from "./users";

let db: Db;
const ada = "00000000-0000-4000-8000-000000000001";
const bob = "00000000-0000-4000-8000-000000000002";

const ld = (data: unknown) => `<html><script type="application/ld+json">${JSON.stringify(data)}</script><p>Your trip</p></html>`;
const flight = (number: string, from: string, to: string, at: string, status = "Confirmed") => ({
  "@type": "FlightReservation",
  reservationNumber: "RXJ34P",
  reservationStatus: `http://schema.org/Reservation${status}`,
  reservationFor: { "@type": "Flight", flightNumber: number, airline: { iataCode: "UA", name: "United" }, departureAirport: { iataCode: from }, arrivalAirport: { iataCode: to }, departureTime: at },
});
const mail = (id: string, html: string | null, text: string | null = null) => ({ source: "forward" as const, messageId: id, from: "united@united.com", subject: "Your trip", html, text });

beforeEach(async () => {
  db = await createPgliteDb();
  await migrate(db);
  await insertUser(db, { id: ada, email: "ada@example.com", passwordHash: "x", createdAt: 1 });
  await insertUser(db, { id: bob, email: "bob@example.com", passwordHash: "x", createdAt: 1 });
});

describe("ingesting mail", () => {
  it("turns a round-trip confirmation into one trip and ignores the same message twice", async () => {
    const html = ld([flight("UA837", "SFO", "NRT", "2027-03-01T11:00:00-08:00"), flight("UA838", "NRT", "SFO", "2027-03-10T17:00:00+09:00")]);
    const first = await ingestMail(db, ada, mail("<m1@united>", html), 1000);
    expect(first).toMatchObject({ status: "parsed", items: 2 });
    expect(await ingestMail(db, ada, mail("<m1@united>", html), 2000)).toEqual({ status: "duplicate" });
    const { journeys, unfiled } = await listJourneys(db, ada);
    expect(unfiled).toEqual([]);
    expect(journeys).toHaveLength(1);
    expect(journeys[0]).toMatchObject({ title: "Tokyo, March 2027", destination: "Tokyo", startDate: "2027-03-01", endDate: "2027-03-10", source: "email" });
    expect(journeys[0].items.map((i) => i.title)).toEqual(["UA 837 · SFO → NRT", "UA 838 · NRT → SFO"]);
  });

  it("files a later hotel email into the same trip and updates a re-sent booking instead of duplicating it", async () => {
    await ingestMail(db, ada, mail("<a>", ld(flight("UA837", "SFO", "NRT", "2027-03-01T11:00"))), 1000);
    const hotel = { "@type": "LodgingReservation", reservationNumber: "H1", checkinDate: "2027-03-02", checkoutDate: "2027-03-08", reservationFor: { name: "Hotel Gracery", address: { addressLocality: "Tokyo" } } };
    await ingestMail(db, ada, mail("<b>", ld(hotel)), 2000);
    await ingestMail(db, ada, mail("<c>", ld({ ...hotel, checkoutDate: "2027-03-09" })), 3000);
    const { journeys } = await listJourneys(db, ada);
    expect(journeys).toHaveLength(1);
    expect(journeys[0].endDate).toBe("2027-03-09");
    const stays = journeys[0].items.filter((i) => i.kind === "stay");
    expect(stays).toHaveLength(1);
    expect(stays[0].endDate).toBe("2027-03-09");
  });

  it("marks a cancellation on the existing booking", async () => {
    await ingestMail(db, ada, mail("<a>", ld(flight("UA837", "SFO", "NRT", "2027-03-01T11:00"))), 1000);
    await ingestMail(db, ada, mail("<b>", ld(flight("UA837", "SFO", "NRT", "2027-03-01T11:00", "Cancelled"))), 2000);
    const { journeys } = await listJourneys(db, ada);
    expect(journeys[0].items.map((i) => i.status)).toEqual(["cancelled"]);
  });

  it("keeps mail without markup for the AI reader, and nothing at all when it's empty", async () => {
    expect(await ingestMail(db, ada, mail("<x>", "<p>Your table for 2 at Nopa, Fri 7pm</p>"), 1000)).toEqual({ status: "needs_ai" });
    expect(await ingestMail(db, ada, mail("<y>", null, "  "), 1000)).toMatchObject({ status: "parsed", items: 0 });
    const pending = await pendingMail(db, ada, 5);
    expect(pending).toHaveLength(1);
    expect(pending[0].body).toContain("Your table for 2 at Nopa, Fri 7pm");
    expect(await pendingMail(db, bob, 5)).toEqual([]);
    expect((await mailNeedingAttention(db, ada)).map((m) => m.state)).toEqual(["needs_ai"]);
    expect(await purgeStaleBodies(db, 5000)).toBe(1);
    expect(await pendingMail(db, ada, 5)).toEqual([]);
    expect(await deleteMail(db, ada, pending[0].id)).toBe(true);
  });

  it("reads text out of HTML mail", () => {
    expect(htmlToText("<style>p{}</style><p>Check-in&nbsp;<b>Mar 2</b></p><p>Conf &#35;88 &amp; more</p>")).toBe("Check-in Mar 2\nConf #88 & more");
    expect(mailBody({ html: null, text: "x".repeat(70_000) })).toHaveLength(60_000);
  });
});

describe("trips and items", () => {
  it("leaves a reservation that fits no trip unfiled, then files it by hand", async () => {
    const dinner = DraftItemSchema.parse({ kind: "dining", title: "Nopa", startDate: "2027-06-01", startTime: "19:00" });
    expect(await fileItems(db, ada, [dinner], "email", 1000)).toBeNull();
    const id = await upsertJourney(db, ada, { id: "20000000-0000-4000-8000-000000000001", title: "SF", destination: "San Francisco", startDate: "2027-06-01", endDate: "2027-06-03", source: "manual", now: 1000 });
    const { unfiled } = await listJourneys(db, ada);
    // Another account can't move it, or move it into a trip it doesn't own.
    expect(await updateItem(db, bob, unfiled[0].id, { journeyId: id }, 2000)).toBeNull();
    const bobTrip = await upsertJourney(db, bob, { id: "20000000-0000-4000-8000-000000000002", title: "B", destination: null, startDate: null, endDate: null, source: "manual", now: 1 });
    expect(await updateItem(db, ada, unfiled[0].id, { journeyId: bobTrip }, 2000)).toBeNull();
    const moved = await updateItem(db, ada, unfiled[0].id, { journeyId: id, note: "Ask for the counter", status: "planned" }, 2000);
    expect(moved).toMatchObject({ journeyId: id, status: "planned", details: { note: "Ask for the counter" } });
    expect((await updateItem(db, ada, unfiled[0].id, { note: null }, 3000))?.details).toEqual({});
    expect((await getJourney(db, ada, id))?.items).toHaveLength(1);
    expect(await getJourney(db, bob, id)).toBeNull();
  });

  it("re-imports by external key, edits, clears suggestions and deletes", async () => {
    const base = { title: "Lisbon", destination: "Lisbon", startDate: "2026-05-01", endDate: "2026-05-05", source: "wanderlog" as const, externalKey: "wanderlog:abc", now: 1 };
    const id = await upsertJourney(db, ada, { ...base, id: "20000000-0000-4000-8000-000000000003" });
    expect(await upsertJourney(db, ada, { ...base, id: "20000000-0000-4000-8000-000000000004", title: "Lisbon trip" })).toBe(id);
    expect(await updateJourney(db, ada, id, { title: "Lisboa", endDate: "2026-05-06" }, 2)).toBe(true);
    expect(await updateJourney(db, bob, id, { title: "x" }, 2)).toBe(false);
    const suggestion = DraftItemSchema.parse({ kind: "dining", status: "suggested", title: "Cervejaria Ramiro", startDate: "2026-05-02" });
    await upsertItem(db, ada, { id: "30000000-0000-4000-8000-000000000001", journeyId: id, source: "ai", dedupeKey: null, item: suggestion, now: 3 });
    await deleteSuggestions(db, ada, id, "dining");
    expect(await getJourney(db, ada, id)).toMatchObject({ title: "Lisboa", endDate: "2026-05-06", items: [] });
    expect(await deleteJourney(db, bob, id)).toBe(false);
    expect(await deleteJourney(db, ada, id)).toBe(true);
  });
});

describe("forwarding address and Flint pairing", () => {
  it("maps a forwarding token to its account and rotates it", async () => {
    expect(await ensureInboxToken(db, ada, "t0")).toBe("t0");
    expect(await ensureInboxToken(db, ada, "racer")).toBe("t0");
    await setInboxToken(db, ada, "t1");
    expect(await userForInbox(db, "t1")).toBe(ada);
    await setInboxToken(db, ada, "t2");
    expect(await userForInbox(db, "t1")).toBeNull();
    expect(await inboxToken(db, ada)).toBe("t2");
  });

  it("uses a pairing code once and refuses an expired one", async () => {
    await insertPairCode(db, ada, "h1", 10_000);
    expect(await takePairCode(db, "h1", 5000)).toBe(ada);
    expect(await takePairCode(db, "h1", 5000)).toBeNull();
    await insertPairCode(db, ada, "h2", 10_000);
    expect(await takePairCode(db, "h2", 20_000)).toBeNull();
  });

  it("stores, lists and removes Flint links", async () => {
    const id = "40000000-0000-4000-8000-000000000001";
    expect(await insertLink(db, ada, { id, sealedSecret: "s", deviceName: "MacBook", now: 1 })).toBe(true);
    expect(await insertLink(db, bob, { id, sealedSecret: "s2", deviceName: "x", now: 1 })).toBe(false);
    expect(await linkSecret(db, id)).toEqual({ userId: ada, sealedSecret: "s" });
    await touchLink(db, id, 5000);
    expect((await listLinks(db, ada))[0]).toMatchObject({ deviceName: "MacBook", lastDeliveryAt: 5000 });
    expect(await deleteLink(db, id, bob)).toBe(false);
    expect(await deleteLink(db, id, ada)).toBe(true);
  });

  it("records one message per account", async () => {
    const m = { id: "50000000-0000-4000-8000-000000000001", source: "flint" as const, messageId: "<z>", sender: "a", subject: "b", now: 1 };
    expect(await insertMail(db, ada, m)).toBe(m.id);
    expect(await insertMail(db, ada, { ...m, id: "50000000-0000-4000-8000-000000000002" })).toBeNull();
    expect(await insertMail(db, bob, { ...m, id: "50000000-0000-4000-8000-000000000003" })).not.toBeNull();
  });
});
