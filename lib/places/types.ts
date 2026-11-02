// Places for the trip organizer: search-as-you-type, the details panel, and
// the drive between stops. Google Places (New) when GOOGLE_PLACES_KEY is set;
// otherwise OpenStreetMap search, which has names and locations but no ratings.

export type LatLng = { lat: number; lng: number };

export type PlaceKind = "dining" | "stay" | "activity";

/** One row in the "Add a place" list. OpenStreetMap rows already carry their location. */
export type Suggestion = {
  /** "g:<Google place id>" or "osm:<type><id>". */
  id: string;
  name: string;
  secondary: string;
  kind: PlaceKind;
  location: LatLng | null;
  address: string | null;
};

/** What the details panel shows. Only Google fills the ratings, hours and photos. */
export type PlaceDetails = {
  id: string;
  name: string;
  address: string | null;
  location: LatLng | null;
  category: string | null;
  kind: PlaceKind;
  rating: number | null;
  ratingCount: number | null;
  priceLevel: string | null;
  phone: string | null;
  website: string | null;
  mapsUrl: string;
  openNow: boolean | null;
  /** "Monday: 9 AM – 5 PM", Monday first. */
  hours: string[];
  summary: string | null;
  /** Opaque photo names for /api/places/photo. */
  photos: string[];
};

/** A drive between two stops. */
export type Leg = { seconds: number; meters: number };

const DINING = /restaurant|cafe|coffee|bar|bakery|food|meal|diner|bistro|pub|brewery|winery|ice_cream|dessert/;
const STAY = /lodging|hotel|motel|resort|hostel|guest_house|bed_and_breakfast|inn|campground|apartment/;

export function kindOf(types: string[]): PlaceKind {
  const joined = types.join(" ");
  if (STAY.test(joined)) return "stay";
  if (DINING.test(joined)) return "dining";
  return "activity";
}

export const mapsSearchUrl = (query: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query.trim())}`;

export function directionsUrl(from: { query: string; location: LatLng | null }, to: { query: string; location: LatLng | null }): string {
  const point = (p: { query: string; location: LatLng | null }) => (p.location ? `${p.location.lat},${p.location.lng}` : p.query);
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(point(from))}&destination=${encodeURIComponent(point(to))}&travelmode=driving`;
}

/** "36 min · 23.7 mi". */
export function legLabel(leg: Leg): string {
  const minutes = Math.max(1, Math.round(leg.seconds / 60));
  const time = minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
  const miles = leg.meters / 1609.344;
  return `${time} · ${miles < 99.95 ? miles.toFixed(1) : Math.round(miles)} mi`;
}
