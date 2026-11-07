import { describe, expect, it } from "vitest";
import { cityForAirport } from "./jsonld";
import { dedupeKey, destinationOf, journeyTitle, placeBatch, plannedMatch, spanOf } from "./group";
import { DraftItemSchema, type DraftItem, type Item, type Journey } from "./types";

const item = (over: Partial<DraftItem> & Pick<DraftItem, "kind" | "title" | "startDate">): DraftItem => DraftItemSchema.parse(over);
const outbound = item({ kind: "flight", title: "UA 837 · SFO → NRT", startDate: "2027-03-01", startTime: "11:00", place: "Tokyo", details: { flightNumber: "UA 837", from: "SFO", to: "NRT" } });
const home = item({ kind: "flight", title: "UA 838 · NRT → SFO", startDate: "2027-03-10", place: "SF Bay Area", details: { flightNumber: "UA 838", from: "NRT", to: "SFO" } });
const hotel = item({ kind: "stay", title: "Hotel Gracery", startDate: "2027-03-02", endDate: "2027-03-06", place: "Tokyo", confirmation: "88 812" });
const dinner = item({ kind: "dining", title: "Sushi Saito", startDate: "2027-03-03", startTime: "19:30" });

const journey = (over: Partial<Journey>): Journey => ({ id: "j1", title: "Tokyo", destination: "Tokyo", startDate: "2027-03-01", endDate: "2027-03-06", travelers: null, tripType: null, shareToken: null, source: "email", createdAt: 0, ...over });

describe("dedupe keys", () => {
  it("identifies a flight segment by number and date, not by confirmation", () => {
    expect(dedupeKey(outbound)).toBe("flight:ua837:2027-03-01");
    expect(dedupeKey({ ...outbound, confirmation: "ABC123" })).toBe("flight:ua837:2027-03-01");
    expect(dedupeKey({ ...outbound, details: { from: "SFO", to: "NRT" } })).toBe("flight:sfo-nrt:2027-03-0111:00");
    // A hand-added flight with no number or airports never merges with another.
    expect(dedupeKey({ ...outbound, details: {} })).toBeNull();
  });

  it("uses the confirmation for stays and reservations, else name and time", () => {
    expect(dedupeKey(hotel)).toBe("stay:conf:88812");
    expect(dedupeKey({ ...hotel, confirmation: null })).toBe("stay:hotelgracery:2027-03-02");
    expect(dedupeKey(dinner)).toBe("dining:sushisaito:2027-03-0319:30");
  });

  it("keys each leg of a multi-leg train booking separately", () => {
    const leg = (title: string, startDate: string) => item({ kind: "transport", title, startDate, confirmation: "T1" });
    expect(dedupeKey(leg("JR · Tokyo → Kyoto", "2027-03-06"))).not.toBe(dedupeKey(leg("JR · Kyoto → Tokyo", "2027-03-09")));
  });

  it("never dedupes suggestions or notes", () => {
    expect(dedupeKey({ ...dinner, status: "suggested" })).toBeNull();
    expect(dedupeKey(item({ kind: "note", title: "Pack adapters", startDate: "2027-03-01" }))).toBeNull();
  });
});

describe("placing a batch", () => {
  it("spans and names the batch", () => {
    expect(spanOf([outbound, hotel])).toEqual({ start: "2027-03-01", end: "2027-03-06" });
    expect(spanOf([])).toBeNull();
    expect(destinationOf([outbound, hotel])).toBe("Tokyo");
    expect(journeyTitle("Tokyo", "2027-03-01")).toBe("Tokyo, March 2027");
    expect(journeyTitle(null, "2027-12-01")).toBe("Trip, December 2027");
  });

  it("creates a trip for a first flight", () => {
    expect(placeBatch([outbound], [], [], cityForAirport)).toEqual({ action: "create", title: "Tokyo, March 2027", destination: "Tokyo", span: { start: "2027-03-01", end: "2027-03-01" } });
  });

  it("joins the trip that already holds one of the bookings", () => {
    expect(placeBatch([hotel], [journey({ id: "a" }), journey({ id: "b" })], ["b", "b"], cityForAirport)).toEqual({ action: "attach", journeyId: "b" });
    expect(placeBatch([hotel], [], ["a", "b"], cityForAirport)).toEqual({ action: "unfiled" });
  });

  it("joins a trip whose dates overlap, give or take a day", () => {
    expect(placeBatch([dinner], [journey({})], [], cityForAirport)).toEqual({ action: "attach", journeyId: "j1" });
    expect(placeBatch([item({ ...dinner, startDate: "2027-03-07" })], [journey({})], [], cityForAirport)).toEqual({ action: "attach", journeyId: "j1" });
  });

  it("files the flight home with the trip it leaves from", () => {
    expect(placeBatch([home], [journey({ endDate: "2027-03-02" })], [], cityForAirport)).toEqual({ action: "attach", journeyId: "j1" });
  });

  it("leaves it unfiled when two trips fit, or when a reservation fits none", () => {
    expect(placeBatch([dinner], [journey({ id: "a" }), journey({ id: "b" })], [], cityForAirport)).toEqual({ action: "unfiled" });
    expect(placeBatch([dinner], [journey({ startDate: "2027-05-01", endDate: "2027-05-04" })], [], cityForAirport)).toEqual({ action: "unfiled" });
  });

  it("doesn't merge a booking in another city just because the dates touch", () => {
    const paris = journey({ id: "p", title: "Paris", destination: "Paris", startDate: "2027-03-01", endDate: "2027-03-05" });
    expect(placeBatch([{ ...hotel, startDate: "2027-03-06", endDate: "2027-03-09" }], [paris], [], cityForAirport)).toEqual({ action: "unfiled" });
    // A reservation with no city still joins by date alone.
    expect(placeBatch([item({ kind: "dining", title: "X", startDate: "2027-03-03" })], [paris], [], cityForAirport)).toEqual({ action: "attach", journeyId: "p" });
  });

  it("doesn't open a trip for a cancellation alone", () => {
    expect(placeBatch([{ ...outbound, status: "cancelled" }], [], [], cityForAirport)).toEqual({ action: "unfiled" });
  });
});

describe("a confirmation for a stop already planned", () => {
  const stop = (over: Partial<Item>): Item => ({ ...item({ kind: "dining", title: "Penca", startDate: "2026-11-21", startTime: "19:30", status: "planned" }), id: "s1", journeyId: "j1", source: "manual", dedupeKey: null, updatedAt: 0, ...over });
  const resy = item({ kind: "dining", title: "Penca", startDate: "2026-11-21", startTime: "19:00", details: { provider: "Resy", guests: 4 } });

  it("finds the planned stop by name and day, whatever time was pencilled in", () => {
    expect(plannedMatch(resy, [stop({})])?.id).toBe("s1");
    expect(plannedMatch(resy, [stop({ title: "Dinner at Penca" })])?.id).toBe("s1");
    expect(plannedMatch({ ...resy, title: "The Flying V at Loews Ventana Canyon Resort" }, [stop({ title: "Flying V" })])?.id).toBe("s1");
    // An AI idea and a booking typed in by hand count too.
    expect(plannedMatch(resy, [stop({ status: "suggested" })])?.id).toBe("s1");
    expect(plannedMatch(resy, [stop({ status: "booked" })])?.id).toBe("s1");
  });

  it("leaves other days, other places, cancelled stops and other bookings alone", () => {
    expect(plannedMatch(resy, [stop({ startDate: "2026-11-22" })])).toBeNull();
    expect(plannedMatch(resy, [stop({ title: "5 Points" })])).toBeNull();
    expect(plannedMatch(resy, [stop({ status: "cancelled" })])).toBeNull();
    expect(plannedMatch(resy, [stop({ journeyId: null })])).toBeNull();
    expect(plannedMatch({ ...resy, confirmation: "111" }, [stop({ confirmation: "222" })])).toBeNull();
    expect(plannedMatch({ ...resy, kind: "stay" }, [stop({ kind: "stay" })])).toBeNull();
  });

  it("picks between two same-named stops only by time", () => {
    const lunch = stop({ id: "lunch", startTime: "12:00" });
    const dinner = stop({ id: "dinner", startTime: "19:00" });
    expect(plannedMatch(resy, [lunch, dinner])?.id).toBe("dinner");
    expect(plannedMatch({ ...resy, startTime: "20:00" }, [lunch, dinner])).toBeNull();
  });
});
