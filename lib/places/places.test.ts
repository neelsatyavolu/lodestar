import { describe, expect, it, vi } from "vitest";
import { centerOf, dayStops, lookupsFor, needsLocation } from "../journeys/locate";
import type { Item, JourneyWithItems } from "../journeys/types";
import { googleClient, PlacesError } from "./google";
import { osmSearch } from "./osm";
import { directionsUrl, kindOf, legLabel } from "./types";

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
    expect(out).toEqual([{ id: "g:ChIJabc123xyz", name: "Penca", secondary: "Broadway Blvd, Tucson", kind: "dining", location: null, address: null }]);
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
  it("returns places with their location and address", async () => {
    const f = fake({ features: [{ geometry: { coordinates: [-110.97, 32.22] }, properties: { osm_type: "N", osm_id: 42, name: "Penca", osm_key: "amenity", osm_value: "restaurant", housenumber: "50", street: "E Broadway Blvd", city: "Tucson", state: "Arizona", country: "United States" } }, { properties: {} }] });
    expect(await osmSearch("penca", { lat: 32, lng: -110 }, 6, f)).toEqual([{ id: "osm:N42", name: "Penca", secondary: "Tucson, Arizona, United States", kind: "dining", location: { lat: 32.22, lng: -110.97 }, address: "50 E Broadway Blvd, Tucson, Arizona, United States" }]);
    expect(calls(f)[0][0]).toContain("lat=32&lon=-110");
    expect(await osmSearch("x", null, 6, fake({}, 500))).toEqual([]);
  });
});

describe("map pins", () => {
  const base = (over: Partial<Item>): Item => ({ id: "i", journeyId: "j", kind: "activity", status: "planned", title: "Desert Museum", startDate: "2026-11-22", startTime: null, endDate: null, endTime: null, place: "Tucson", confirmation: null, details: {}, source: "manual", dedupeKey: null, updatedAt: 0, ...over });
  const trip = (items: Item[]): JourneyWithItems => ({ id: "j", title: "Tucson", destination: "Tucson", startDate: "2026-11-21", endDate: "2026-11-26", source: "manual", createdAt: 0, items });

  it("pins flights to the arrival airport and looks everything else up by name and address", () => {
    const items = [
      base({ id: "f", kind: "flight", title: "UA 1", details: { to: "TUS" } }),
      base({ id: "h", kind: "stay", title: "The Ritz-Carlton, Dove Mountain", details: { address: "15000 N Secret Springs Dr, Marana, AZ" } }),
      base({ id: "c", status: "cancelled" }),
      base({ id: "t", kind: "transport", title: "Shuttle" }),
      base({ id: "done", details: { lat: 1, lng: 2, placeId: "osm:N1" } }),
    ];
    const out = lookupsFor(trip(items), Date.now());
    expect(out[0]).toMatchObject({ id: "f", location: { lat: expect.any(Number), lng: expect.any(Number) } });
    expect(out.slice(1)).toEqual([{ id: "h", query: "The Ritz-Carlton, Dove Mountain, 15000 N Secret Springs Dr, Marana, AZ", address: "15000 N Secret Springs Dr, Marana, AZ" }]);
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
    expect(dayStops([...items, base({ id: "hotel", kind: "stay", details: { lat: 7, lng: 8 } }), base({ id: "added", details: { lat: 9, lng: 9 } })], "2026-11-22").map((i) => i.id)).toEqual(["a", "b", "added", "hotel"]);
    expect(centerOf(items.slice(0, 2))).toEqual({ lat: 2, lng: 3 });
    expect(centerOf([])).toBeNull();
  });
});
