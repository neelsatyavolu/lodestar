import { post } from "@/lib/client";
import { addDays } from "@/lib/format";
import type { LatLng, PlaceDetails, Suggestion } from "@/lib/places/types";
import { PlaceSearch } from "./place-search";

// "Add a place" at the foot of each day: search near the trip and add the
// pick to that day, or keep the text as a note.

export function AddPlace({ journeyId, date, near, onAdded }: { journeyId: string; date: string; near: LatLng | null; onAdded: () => void }) {
  const addNote = async (text: string) => {
    await post(`/api/journeys/${journeyId}/items`, { kind: "note", status: "planned", title: text.slice(0, 160), startDate: date });
    onAdded();
  };

  const addPlace = async (s: Suggestion, place: PlaceDetails | null) => {
    const location = place?.location ?? s.location;
    const address = place?.address ?? s.address;
    const kind = place?.kind ?? s.kind;
    await post(`/api/journeys/${journeyId}/items`, {
      kind,
      status: "planned",
      title: (place?.name ?? s.name).slice(0, 160),
      startDate: date,
      // A stay picked here starts as one night; the details panel changes the dates.
      endDate: kind === "stay" ? addDays(date, 1) : null,
      place: s.secondary.split(",")[0]?.trim() || null,
      details: {
        placeId: s.id,
        ...(address ? { address: address.slice(0, 240) } : {}),
        ...(location ? { lat: location.lat, lng: location.lng, locatedAt: Date.now() } : {}),
        ...(place?.mapsUrl ? { url: place.mapsUrl } : {}),
        ...(place?.rating ? { rating: place.rating } : {}),
      },
    });
    onAdded();
  };

  return (
    <div className="mt-2">
      <PlaceSearch near={near} label={`Add a place on ${date}`} placeholder="Add a place" onNote={addNote} onPick={addPlace} />
    </div>
  );
}
