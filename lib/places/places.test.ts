import { describe, expect, it, vi } from "vitest";
import { dayStops, lookupsFor, needsLocation, RETRY_FAILED_MS, searchCenter } from "../journeys/locate";
import type { Item, JourneyWithItems } from "../journeys/types";
import { googleClient, PlacesError } from "./google";
import { dedupe, osmSearch } from "./osm";
import { osrmLegs } from "./osrm";
import { coreName, onStreet, resolvePlace, sameName, type Search } from "./resolve";
import { categoryOf, directionsUrl, kindOf, legLabel, type Suggestion } from "./types";

type Call = [string, RequestInit];
const fake = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const calls = (f: typeof fetch) => (f as unknown as { mock: { calls: Call[] } }).mock.calls;

describe("place helpers", () => {
  it("sorts places into dining, stays and things to do", () => {
    expect(kindOf(["restaurant", "food"])).toBe("dining");
    expect(kindOf(["lodging"])).toBe("stay");
    expect(kindOf(["museum", "tourist_attraction"])).toBe("activity");
  });

  it("labels a drive and links directions", () => {
    expect(legLabel({ seconds: 2160, meters: 38_142 })).toBe("36 min · 23.7 mi");
    expect(legLabel({ seconds: 5400, meters: 160_934 })).toBe("1 hr 30 min · 100 mi");
    expect(directionsUrl({ query: "A", location: { lat: 1, lng: 2 } }, { query: "Penca, Tucson", location: null })).toBe("https://www.google.com/maps/dir/?api=1&origin=1%2C2&destination=Penca%2C%20Tucson&travelmode=driving");
  });
});

describe("Google Places client", () => {
  it("autocompletes near the trip with a session token and the key in a header", async () => {
    const f = fake({ suggestions: [{ placePrediction: { placeId: "ChIJabc123xyz", structuredFormat: { mainText: { text: "Penca" }, secondaryText: { text: "Broadway Blvd, Tucson" } }, types: ["restaurant"] } }, { queryPrediction: {} }] });
    const out = await googleClient("KEY", f).autocomplete("penca", { lat: 32.2, lng: -110.9 }, "sess-1");
    expect(out).toEqual([{ id: "g:ChIJabc123xyz", name: "Penca", secondary: "Broadway Blvd, Tucson", category: "Restaurant", kind: "dining", location: null, address: null }]);
    const [url, init] = calls(f)[0];
    expect(url).toBe("https://places.googleapis.com/v1/places:autocomplete");
    expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("KEY");
    expect(JSON.parse(init.body as string)).toMatchObject({ sessionToken: "sess-1", locationBias: { circle: { center: { latitude: 32.2, longitude: -110.9 } } } });
  });

  it("maps place details, asking only for the fields it shows", async () => {
    const f = fake({
      id: "ChIJabc123xyz", displayName: { text: "Penca Restaurante" }, formattedAddress: "50 E Broadway Blvd, Tucson, AZ 85701", location: { latitude: 32.22, longitude: -110.97 },
      types: ["mexican_restaurant", "restaurant"], primaryTypeDisplayName: { text: "Mexican restaurant" }, rating: 4.3, userRatingCount: 914, priceLevel: "PRICE_LEVEL_MODERATE",
      nationalPhoneNumber: "(520) 203-7681", websiteUri: "https://www.pencarestaurante.com/", googleMapsUri: "https://maps.google.com/?cid=1",
      regularOpeningHours: { weekdayDescriptions: ["Monday: Closed", "Saturday: 3:00 – 9:30 PM"] }, currentOpeningHours: { openNow: false },
      editorialSummary: { text: "Upscale Mexican fare." }, photos: [{ name: "places/ChIJabc123xyz/photos/AbCdEf123456" }],
    });
    const p = await googleClient("KEY", f).details("ChIJabc123xyz", "sess-1");
    expect(p).toMatchObject({ id: "g:ChIJabc123xyz", name: "Penca Restaurante", kind: "dining", category: "Mexican restaurant", rating: 4.3, ratingCount: 914, priceLevel: "$$", openNow: false, phone: "(520) 203-7681", photos: ["places/ChIJabc123xyz/photos/AbCdEf123456"], location: { lat: 32.22, lng: -110.97 } });
    const [url, init] = calls(f)[0];
    expect(url).toBe("https://places.googleapis.com/v1/places/ChIJabc123xyz?sessionToken=sess-1");
    expect((init.headers as Record<string, string>)["X-Goog-FieldMask"]).toContain("rating,userRatingCount,priceLevel");
  });

  it("locates by text, reads drive time, and explains failures plainly", async () => {
    expect(await googleClient("K", fake({ places: [{ id: "ChIJxyz", location: { latitude: 1, longitude: 2 } }] })).locate("Penca, Tucson", null)).toEqual({ placeId: "ChIJxyz", location: { lat: 1, lng: 2 } });
    expect(await googleClient("K", fake({})).locate("nowhere", null)).toBeNull();
    expect(await googleClient("K", fake({ routes: [{ duration: "2160s", distanceMeters: 38142 }] })).drive({ lat: 1, lng: 2 }, { lat: 3, lng: 4 })).toEqual({ seconds: 2160, meters: 38142 });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(googleClient("K", fake({ error: { message: "API key not valid" } }, 403)).details("x", null)).rejects.toBeInstanceOf(PlacesError);
    err.mockRestore();
  });
});

describe("OpenStreetMap search", () => {
  const feature = (name: string, key: string, value: string, lng: number, lat: number, extra: Record<string, unknown> = {}) => ({
    geometry: { coordinates: [lng, lat] },
    properties: { osm_type: "N", osm_id: Math.round(lat * 1e4 + lng), name, osm_key: key, osm_value: value, city: "Phoenix", state: "Arizona", country: "United States", ...extra },
  });

  it("returns places with their location, address and what they are", async () => {
    const f = fake({ features: [{ geometry: { coordinates: [-110.97, 32.22] }, properties: { osm_type: "N", osm_id: 42, name: "Penca", osm_key: "amenity", osm_value: "restaurant", housenumber: "50", street: "E Broadway Blvd", city: "Tucson", state: "Arizona", country: "United States" } }, { properties: {} }] });
    expect(await osmSearch("penca", { lat: 32, lng: -110 }, 6, f)).toEqual([
      { id: "osm:N42", name: "Penca", secondary: "50 E Broadway Blvd, Tucson, Arizona, United States", category: "Restaurant", kind: "dining", location: { lat: 32.22, lng: -110.97 }, address: "50 E Broadway Blvd, Tucson, Arizona, United States" },
    ]);
    expect(calls(f)[0][0]).toContain("lat=32.000&lon=-110.000");
    // No answer is not "no such place": it throws, so a booking isn't marked unfindable.
    await expect(osmSearch("x unanswered", null, 6, fake({}, 500))).rejects.toBeInstanceOf(PlacesError);
  });

  it("puts the airport above the office park and parking lots, and lists it once", async () => {
    const f = fake({
      features: [
        feature("Sky Harbor Office Plaza", "landuse", "commercial", -111.98, 33.426),
        feature("Sky Harbor Employee Parking", "amenity", "parking", -111.99, 33.44),
        feature("Phoenix Sky Harbor International Airport", "aeroway", "aerodrome", -112.0068, 33.4328),
      ],
    });
    const out = await osmSearch("sky harbor", { lat: 33.45, lng: -112.07 }, 6, f);
    expect(out[0].name).toBe("Phoenix Sky Harbor International Airport");
    expect(out[0].category).toBe("Airport");
    expect(out.at(-1)!.name).toBe("Sky Harbor Office Plaza");
  });

  it("finds airports from our own list by city and code", async () => {
    const out = await osmSearch("phoenix airport", { lat: 33.45, lng: -112.07 }, 6, fake({ features: [feature("Phoenix Airport Center", "landuse", "industrial", -111.98, 33.426), feature("Phoenix Airport Center", "landuse", "commercial", -111.979, 33.4237)] }));
    expect(out[0]).toMatchObject({ category: "Airport", secondary: expect.stringContaining("PHX") });
    expect(out.filter((r) => r.name === "Phoenix Airport Center")).toHaveLength(1);
    expect(out.some((r) => r.secondary.includes("SYX"))).toBe(false);
    expect((await osmSearch("syx", { lat: 33.45, lng: -112.07 }, 6, fake({})))[0].secondary).toContain("SYX");
  });

  it("retries once when Photon is busy", async () => {
    let n = 0;
    const f = vi.fn(async () => (n++ ? new Response(JSON.stringify({ features: [feature("Retry Cafe", "amenity", "cafe", 1, 1)] })) : new Response("busy", { status: 503 }))) as unknown as typeof fetch;
    expect((await osmSearch("retry cafe unique", null, 6, f)).map((r) => r.name)).toEqual(["Retry Cafe"]);
    expect(n).toBe(2);
  });

  it("drops the same place mapped twice but keeps same-named places far apart", () => {
    const row = (id: string, lat: number, secondary = "Phoenix, Arizona"): Suggestion => ({ id, name: "Starbucks", secondary, category: null, kind: "dining", location: { lat, lng: 0 }, address: null });
    expect(dedupe([row("a", 0), row("b", 0.005), row("c", 1)]).map((r) => r.id)).toEqual(["a", "c"]);
    expect(dedupe([row("a", 0, "1 Main St, Phoenix"), row("b", 0.005, "9 Elm St, Phoenix")]).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("names Google's place types", () => {
    expect(categoryOf(["mexican_restaurant", "restaurant", "food"])).toBe("Mexican restaurant");
    expect(categoryOf(["lodging", "point_of_interest"])).toBe("Hotel");
    expect(categoryOf(["point_of_interest"])).toBeNull();
  });
});

describe("pinning a booking", () => {
  const hit = (name: string, lat: number, lng: number): Suggestion => ({ id: `osm:${name}`, name, secondary: "", category: null, kind: "activity", location: { lat, lng }, address: null });
  const searcher = (answers: Record<string, Suggestion[]>) => {
    const asked: string[] = [];
    const search: Search = async (q) => (asked.push(q), answers[q] ?? []);
    return { search, asked };
  };
  const lisbon = { lat: 38.72, lng: -9.14 };

  it("takes a match only when the name agrees", async () => {
    expect(sameName("The Ritz-Carlton, Dove Mountain", "The Ritz-Carlton Dove Mountain")).toBe(true);
    expect(sameName("Sintra day trip", "Águas Livres Aqueduct")).toBe(false);
    expect(coreName("Sintra day trip")).toBe("sintra");
    // A shared common word, or one brand word of two, is another place.
    expect(sameName("Hotel Aurora", "Hotel Central")).toBe(false);
    expect(sameName("Hilton Garden Inn", "Hilton Tucson El Conquistador")).toBe(false);
    expect(sameName("Hilton Garden Inn", "Hilton Garden Inn Tucson Airport")).toBe(true);
    expect(sameName("The Grill", "The Grill")).toBe(true);
    expect(sameName("The Grill", "Grill House")).toBe(false);
  });

  it("drops the plan words and searches again: 'Sintra day trip' pins to Sintra", async () => {
    const { search, asked } = searcher({ "Sintra day trip, Lisbon": [hit("Águas Livres Aqueduct", 38.77, -9.25)], "sintra, Lisbon": [hit("Sintra", 38.8, -9.38)] });
    expect(await resolvePlace({ title: "Sintra day trip", address: null, city: "Lisbon" }, lisbon, search)).toMatchObject({ name: "Sintra" });
    expect(asked).toEqual(["Sintra day trip, Lisbon", "sintra, Lisbon"]);
  });

  it("ignores a same-named place in another country, then falls back to the street address", async () => {
    const { search } = searcher({
      "Cervejaria Ramiro, Av. Almirante Reis 1, Lisbon": [hit("Cervejaria Ramiro", -23.5, -46.6)],
      "Av. Almirante Reis 1, Lisbon": [hit("Avenida Almirante Reis", 38.72, -9.135)],
    });
    expect(await resolvePlace({ title: "Cervejaria Ramiro", address: "Av. Almirante Reis 1, Lisbon", city: "Lisbon" }, lisbon, search)).toMatchObject({ name: "Avenida Almirante Reis" });
  });

  it("pins to a street address only when the answer is on that street", async () => {
    const at = (name: string, address: string): Suggestion => ({ ...hit(name, 38.72, -9.14), address });
    expect(onStreet("15000 N Secret Springs Dr, Marana, AZ", at("Tortolita Mountain Park", "15000 North Secret Springs Drive, Marana"))).toBe(true);
    expect(onStreet("15000 N Secret Springs Dr, Marana, AZ", at("Secret Garden Cafe", "12 Oak Street, Marana"))).toBe(false);
    const { search } = searcher({ "Rua Augusta 24, Lisbon": [at("Rua da Prata", "Rua da Prata, Lisbon")] });
    expect(await resolvePlace({ title: "Some Shop", address: "Rua Augusta 24, Lisbon", city: "Lisbon" }, lisbon, search)).toBeNull();
  });

  it("gives up rather than pin the wrong thing", async () => {
    const { search } = searcher({ "Mystery dinner, Lisbon": [hit("Some Bakery", 38.72, -9.14)] });
    expect(await resolvePlace({ title: "Mystery dinner", address: null, city: "Lisbon" }, lisbon, search)).toBeNull();
  });
});

describe("free drive times", () => {
  it("reads every leg of the day from one OSRM route", async () => {
    const f = fake({ code: "Ok", routes: [{ legs: [{ duration: 600.4, distance: 5000 }, { duration: 1200, distance: 20000 }] }] });
    expect(await osrmLegs([{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }, { lat: 5, lng: 6 }], f)).toEqual([{ seconds: 600, meters: 5000 }, { seconds: 1200, meters: 20000 }]);
    expect(calls(f)[0][0]).toContain("2.000000,1.000000;4.000000,3.000000;6.000000,5.000000");
    expect(await osrmLegs([{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }], fake({ code: "NoRoute" }))).toEqual([null]);
  });
});

describe("map pins", () => {
  const base = (over: Partial<Item>): Item => ({ id: "i", journeyId: "j", kind: "activity", status: "planned", title: "Desert Museum", startDate: "2026-11-22", startTime: null, endDate: null, endTime: null, place: "Tucson", confirmation: null, details: {}, source: "manual", dedupeKey: null, updatedAt: 0, ...over });
  const trip = (items: Item[]): JourneyWithItems => ({ id: "j", title: "Tucson", destination: "Tucson", startDate: "2026-11-21", endDate: "2026-11-26", travelers: null, tripType: null, shareToken: null, source: "manual", createdAt: 0, items });

  it("pins flights to the arrival airport and looks everything else up by name, address and city", () => {
    const items = [
      base({ id: "h", kind: "stay", title: "The Ritz-Carlton, Dove Mountain", details: { address: "15000 N Secret Springs Dr, Marana, AZ" } }),
      base({ id: "f", kind: "flight", title: "UA 1", details: { to: "TUS" } }),
      base({ id: "c", status: "cancelled" }),
      base({ id: "t", kind: "transport", title: "Shuttle" }),
      base({ id: "done", details: { lat: 1, lng: 2, placeId: "osm:N1" } }),
    ];
    const out = lookupsFor(trip(items), Date.now());
    expect(out[0]).toMatchObject({ id: "f", location: { lat: expect.any(Number), lng: expect.any(Number) } });
    expect(out.slice(1)).toEqual([{ id: "h", title: "The Ritz-Carlton, Dove Mountain", address: "15000 N Secret Springs Dr, Marana, AZ", city: "Tucson" }]);
  });

  it("tries a place it couldn't find again after a week, not on every visit", () => {
    const now = Date.now();
    expect(needsLocation(base({ details: { locateFailedAt: now - 3_600_000 } }), now)).toBe(false);
    expect(needsLocation(base({ details: { locateFailedAt: now - RETRY_FAILED_MS - 1 } }), now)).toBe(true);
    // A month-old Google pin whose refresh found nothing keeps its pin and waits too.
    expect(needsLocation(base({ details: { lat: 1, lng: 2, placeId: "g:x", locatedAt: now - 40 * 86_400_000, locateFailedAt: now - 1000 } }), now)).toBe(false);
  });

  it("lets Google try what OpenStreetMap couldn't place, but not what Google couldn't", () => {
    const now = Date.now();
    const recent = now - 3_600_000;
    expect(needsLocation(base({ details: { locateFailedAt: recent, locateFailedWith: "osm" } }), now, "google")).toBe(true);
    expect(needsLocation(base({ details: { locateFailedAt: recent } }), now, "google")).toBe(true);
    expect(needsLocation(base({ details: { locateFailedAt: recent, locateFailedWith: "google" } }), now, "google")).toBe(false);
    expect(needsLocation(base({ details: { locateFailedAt: recent, locateFailedWith: "google" } }), now, "osm")).toBe(false);
  });

  it("gives a hotel pinned another way one Google lookup for its photos and rating", () => {
    const now = Date.now();
    const osmHotel = base({ kind: "stay", details: { lat: 1, lng: 2, placeId: "osm:N1" } });
    expect(needsLocation(osmHotel, now, "google")).toBe(true);
    expect(needsLocation(osmHotel, now, "osm")).toBe(false);
    expect(needsLocation({ ...osmHotel, details: { ...osmHotel.details, locateFailedAt: now - 1000, locateFailedWith: "google" } }, now, "google")).toBe(false);
    expect(needsLocation(base({ kind: "transport", details: { lat: 1, lng: 2 } }), now, "google")).toBe(false);
  });

  it("looks Google coordinates up again after 30 days", () => {
    const now = Date.now();
    expect(needsLocation(base({ details: { lat: 1, lng: 2, placeId: "g:x", locatedAt: now - 31 * 86_400_000 } }), now)).toBe(true);
    expect(needsLocation(base({ details: { lat: 1, lng: 2, placeId: "g:x", locatedAt: now } }), now)).toBe(false);
  });

  it("orders a day's stops for drive times and centers searches on the trip", () => {
    const items = [
      base({ id: "b", startTime: "19:00", details: { lat: 3, lng: 4 } }),
      base({ id: "a", startTime: "14:00", details: { lat: 1, lng: 2 } }),
      base({ id: "idea", status: "suggested", details: { lat: 5, lng: 6 } }),
      base({ id: "elsewhere", startDate: "2026-11-23", details: { lat: 5, lng: 6 } }),
    ];
    expect(dayStops(items, "2026-11-22").map((i) => i.id)).toEqual(["a", "b"]);
    // A stay with no time is check-in: it ends the day.
    expect(dayStops([...items, base({ id: "hotel", kind: "stay", endDate: "2026-11-23", details: { lat: 7, lng: 8 } }), base({ id: "added", details: { lat: 9, lng: 9 } })], "2026-11-22").map((i) => i.id)).toEqual(["a", "b", "added", "hotel"]);
  });

  it("searches near the day's stops, never from the flight home", () => {
    const items = [
      base({ id: "out", kind: "flight", startDate: "2026-11-21", startTime: "08:00", details: { lat: 32.1, lng: -110.9 } }),
      base({ id: "home", kind: "flight", startDate: "2026-11-26", details: { lat: 37.6, lng: -122.4 } }),
      base({ id: "a", startDate: "2026-11-22", details: { lat: 32, lng: -111 } }),
      base({ id: "b", startDate: "2026-11-23", details: { lat: 33, lng: -112 } }),
    ];
    expect(searchCenter(items, "2026-11-22")).toEqual({ lat: 32, lng: -111 });
    expect(searchCenter(items, "2026-11-25")).toEqual({ lat: 32.5, lng: -111.5 });
    expect(searchCenter(items.slice(0, 2), null)).toEqual({ lat: 32.1, lng: -110.9 });
    expect(searchCenter([], null)).toBeNull();
  });
});
