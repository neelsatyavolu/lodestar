import { categoryOf, kindOf, mapsSearchUrl, type LatLng, type Leg, type PlaceDetails, type Suggestion } from "./types";

// Google Places API (New) and Routes API over plain HTTP. Every call names the
// fields it needs (Google bills by field), times out, and is validated loosely:
// anything missing just shows as missing. Under Google's terms only place ids,
// and coordinates for up to 30 days, may be stored; details are fetched live.

const PLACES = "https://places.googleapis.com/v1";
const ROUTES = "https://routes.googleapis.com/directions/v2:computeRoutes";
const TIMEOUT_MS = 10_000;
const BIAS_RADIUS_M = 50_000;

const DETAIL_FIELDS = [
  "id", "displayName", "formattedAddress", "location", "types", "primaryTypeDisplayName", "rating", "userRatingCount", "priceLevel",
  "nationalPhoneNumber", "websiteUri", "googleMapsUri", "regularOpeningHours.weekdayDescriptions", "currentOpeningHours.openNow", "editorialSummary", "photos.name",
].join(",");

const PRICE: Record<string, string> = { PRICE_LEVEL_FREE: "Free", PRICE_LEVEL_INEXPENSIVE: "$", PRICE_LEVEL_MODERATE: "$$", PRICE_LEVEL_EXPENSIVE: "$$$", PRICE_LEVEL_VERY_EXPENSIVE: "$$$$" };

export class PlacesError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const latLng = (v: unknown): LatLng | null => {
  const p = o(v);
  const lat = num(p.latitude);
  const lng = num(p.longitude);
  return lat === null || lng === null ? null : { lat, lng };
};
const bias = (near: LatLng | null) => (near ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: BIAS_RADIUS_M } } } : {});

export function googleClient(key: string, fetcher: typeof fetch = fetch) {
  async function call(url: string, init: { method?: string; body?: unknown; fields?: string }): Promise<Obj> {
    let res: Response;
    try {
      res = await fetcher(url, {
        method: init.method ?? "GET",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, ...(init.fields ? { "X-Goog-FieldMask": init.fields } : {}) },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new PlacesError("Couldn't reach Google Maps. Try again.", 502);
    }
    const body = o(await res.json().catch(() => ({})));
    if (!res.ok) {
      // Log Google's reason for us; the traveller gets a plain message.
      console.error("[places] google", res.status, str(o(body.error).message) ?? "");
      throw new PlacesError(res.status === 404 ? "That place wasn't found." : "Google Maps didn't answer. Try again.", res.status === 404 ? 404 : 502);
    }
    return body;
  }

  return {
    async autocomplete(input: string, near: LatLng | null, session: string): Promise<Suggestion[]> {
      const body = await call(`${PLACES}/places:autocomplete`, { method: "POST", body: { input, sessionToken: session, ...bias(near) } });
      const rows = Array.isArray(body.suggestions) ? body.suggestions : [];
      return rows
        .map((s) => o(o(s).placePrediction))
        .filter((p) => str(p.placeId))
        .slice(0, 6)
        .map((p) => {
          const f = o(p.structuredFormat);
          return {
            id: `g:${str(p.placeId)}`,
            name: str(o(f.mainText).text) ?? str(o(p.text).text) ?? "Place",
            secondary: str(o(f.secondaryText).text) ?? "",
            category: categoryOf(Array.isArray(p.types) ? (p.types as string[]) : []),
            kind: kindOf(Array.isArray(p.types) ? (p.types as string[]) : []),
            location: null,
            address: null,
          };
        });
    },

    async details(placeId: string, session: string | null): Promise<PlaceDetails> {
      const q = session ? `?sessionToken=${encodeURIComponent(session)}` : "";
      const p = await call(`${PLACES}/places/${encodeURIComponent(placeId)}${q}`, { fields: DETAIL_FIELDS });
      const name = str(o(p.displayName).text) ?? "Place";
      const address = str(p.formattedAddress);
      const types = Array.isArray(p.types) ? (p.types as string[]) : [];
      const hours = o(p.regularOpeningHours).weekdayDescriptions;
      const openNow = o(p.currentOpeningHours).openNow;
      return {
        id: `g:${placeId}`,
        name,
        address,
        location: latLng(p.location),
        category: str(o(p.primaryTypeDisplayName).text),
        kind: kindOf(types),
        rating: num(p.rating),
        ratingCount: num(p.userRatingCount),
        priceLevel: PRICE[str(p.priceLevel) ?? ""] ?? null,
        phone: str(p.nationalPhoneNumber),
        website: str(p.websiteUri),
        mapsUrl: str(p.googleMapsUri) ?? mapsSearchUrl(`${name} ${address ?? ""}`),
        openNow: typeof openNow === "boolean" ? openNow : null,
        hours: Array.isArray(hours) ? hours.filter((h): h is string => typeof h === "string").slice(0, 7) : [],
        summary: str(o(p.editorialSummary).text),
        photos: (Array.isArray(p.photos) ? p.photos : []).map((ph) => str(o(ph).name)).filter((n): n is string => n !== null).slice(0, 6),
      };
    },

    /** The best match for a name and address, to pin a booking that came from email or an import. */
    async locate(query: string, near: LatLng | null): Promise<{ placeId: string; location: LatLng } | null> {
      const body = await call(`${PLACES}/places:searchText`, { method: "POST", fields: "places.id,places.location", body: { textQuery: query, pageSize: 1, ...bias(near) } });
      const first = o(Array.isArray(body.places) ? body.places[0] : null);
      const location = latLng(first.location);
      const placeId = str(first.id);
      return placeId && location ? { placeId, location } : null;
    },

    /** A short-lived image URL for one of a place's photos (no key in it). */
    async photoUri(name: string, width: number): Promise<string> {
      const body = await call(`${PLACES}/${name}/media?maxWidthPx=${width}&skipHttpRedirect=true`, {});
      const uri = str(body.photoUri);
      if (!uri) throw new PlacesError("No photo.", 404);
      return uri;
    },

    async drive(from: LatLng, to: LatLng): Promise<Leg | null> {
      const point = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
      const body = await call(ROUTES, { method: "POST", fields: "routes.duration,routes.distanceMeters", body: { origin: point(from), destination: point(to), travelMode: "DRIVE" } });
      const route = o(Array.isArray(body.routes) ? body.routes[0] : null);
      const seconds = Number(String(route.duration ?? "").replace(/s$/, ""));
      const meters = num(route.distanceMeters);
      return Number.isFinite(seconds) && seconds > 0 && meters !== null ? { seconds, meters } : null;
    },
  };
}

export type GoogleClient = ReturnType<typeof googleClient>;
