import { Clock, ExternalLink, Globe, MapPin, Phone, Star, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { Item } from "@/lib/journeys/types";
import { mapsSearchUrl, type PlaceDetails } from "@/lib/places/types";
import { Button, Pill, Spinner } from "../ui";
import { DateField } from "./date-field";
import { errorText } from "./shared";

// Everything about one stop: Google's view of the place (photo, rating, price,
// hours, phone, site) above, and the trip's own facts (when, confirmation,
// note) below, editable in place.

const WEEKDAY = new Date().toLocaleDateString("en-US", { weekday: "long" });

function usePlace(placeId: string | undefined) {
  const [state, setState] = useState<{ id: string; place: PlaceDetails | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!placeId?.startsWith("g:")) return;
    let alive = true;
    api<{ place: PlaceDetails }>(`/api/places/details?id=${encodeURIComponent(placeId)}`)
      .then((r) => alive && setState({ id: placeId, place: r.place, error: null }))
      .catch((err) => alive && setState({ id: placeId, place: null, error: errorText(err, "Couldn't load this place.") }));
    return () => {
      alive = false;
    };
  }, [placeId]);
  if (!placeId?.startsWith("g:")) return { place: null, loading: false, error: null };
  return state?.id === placeId ? { place: state.place, loading: false, error: state.error } : { place: null, loading: true, error: null };
}

function GooglePart({ place }: { place: PlaceDetails }) {
  const [allHours, setAllHours] = useState(false);
  const today = place.hours.find((h) => h.startsWith(WEEKDAY));
  return (
    <div className="space-y-2.5 text-[13px] text-body">
      {place.photos[0] && (
        // eslint-disable-next-line @next/next/no-img-element -- a redirect to Google's image host; next/image can't proxy it.
        <img src={`/api/places/photo?name=${encodeURIComponent(place.photos[0])}&w=800`} alt="" className="h-44 w-full rounded-lg bg-elevated object-cover" loading="lazy" />
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {place.rating !== null && (
          <span className="inline-flex items-center gap-1 text-ink">
            <Star size={13} className="fill-warn text-warn" aria-hidden /> {place.rating.toFixed(1)}
            {place.ratingCount !== null && <span className="text-mute">({place.ratingCount.toLocaleString()})</span>}
            <span className="text-[11px] text-ash">Google</span>
          </span>
        )}
        {place.priceLevel && <span className="font-mono text-mute">{place.priceLevel}</span>}
        {place.category && <Pill>{place.category}</Pill>}
      </div>
      {place.summary && <p className="text-body">{place.summary}</p>}
      {place.address && (
        <a href={place.mapsUrl} target="_blank" rel="noopener noreferrer" className="flex gap-2 hover:text-ink">
          <MapPin size={14} className="mt-0.5 shrink-0 text-ash" /> {place.address}
        </a>
      )}
      {place.hours.length > 0 && (
        <div className="flex gap-2">
          <Clock size={14} className="mt-0.5 shrink-0 text-ash" />
          <div>
            <button type="button" onClick={() => setAllHours(!allHours)} className="cursor-pointer text-left hover:text-ink">
              {place.openNow !== null && <span className={place.openNow ? "text-ok" : "text-danger"}>{place.openNow ? "Open now" : "Closed now"} · </span>}
              {today ?? "Hours"} <span className="text-accent">{allHours ? "Hide" : "All week"}</span>
            </button>
            {allHours && (
              <ul className="mt-1 space-y-0.5 text-mute">
                {place.hours.map((h) => (
                  <li key={h} className={h.startsWith(WEEKDAY) ? "text-ink" : ""}>
                    {h}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {place.phone && (
        <a href={`tel:${place.phone.replace(/[^\d+]/g, "")}`} className="flex gap-2 hover:text-ink">
          <Phone size={14} className="mt-0.5 shrink-0 text-ash" /> {place.phone}
        </a>
      )}
      {place.website && (
        <a href={place.website} target="_blank" rel="noopener noreferrer" className="flex min-w-0 gap-2 text-accent hover:underline">
          <Globe size={14} className="mt-0.5 shrink-0" /> <span className="truncate">{place.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</span>
        </a>
      )}
    </div>
  );
}

/** `bare`: inside a sheet that already shows the name and a close button. */
export function PlacePanel({ item, onClose, onChanged, onRemoved, bare = false }: { item: Item; onClose: () => void; onChanged: (i: Item) => void; onRemoved: () => void; bare?: boolean }) {
  const { place, loading, error } = usePlace(item.details.placeId);
  const [note, setNote] = useState(item.details.note ?? "");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const suggested = item.status === "suggested";

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    setSaveError(null);
    try {
      const { item: next } = await api<{ item: Item }>(`/api/journeys/items/${item.id}`, { method: "PATCH", body: JSON.stringify(body) });
      onChanged(next);
    } catch (err) {
      setSaveError(errorText(err, "Couldn't save that."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!suggested && !window.confirm(`Remove ${item.title} from the trip?`)) return;
    try {
      await api(`/api/journeys/items/${item.id}`, { method: "DELETE" });
      onRemoved();
    } catch (err) {
      setSaveError(errorText(err, "Couldn't remove it."));
    }
  };

  const status = (
    <>
      {item.status === "booked" ? "Booked" : suggested ? "Idea" : item.status === "cancelled" ? "Cancelled" : "Planned"}
      {item.confirmation && <span className="font-mono"> · {item.confirmation}</span>}
    </>
  );
  const fallbackMaps = item.details.url ?? mapsSearchUrl(`${item.title} ${item.details.address ?? item.place ?? ""}`);
  return (
    <div className="flex max-h-full flex-col">
      {!bare && (
        <div className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[16px] font-medium text-ink">{place?.name ?? item.title}</h2>
            <p className="mt-0.5 text-[12px] text-mute">{status}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close details" className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-ash hover:text-ink">
            <X size={16} />
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {bare && <p className="text-[12px] text-mute">{status}</p>}
        {loading && <Spinner />}
        {error && <p className="text-[12px] text-mute">{error}</p>}
        {place ? (
          <GooglePart place={place} />
        ) : (
          !loading && (
            <div className="space-y-2 text-[13px] text-body">
              {(item.details.address ?? item.place) && (
                <p className="flex gap-2">
                  <MapPin size={14} className="mt-0.5 shrink-0 text-ash" /> {item.details.address ?? item.place}
                </p>
              )}
              {item.details.why && <p>{item.details.why}</p>}
              <a href={fallbackMaps} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                Open in Google Maps <ExternalLink size={12} />
              </a>
            </div>
          )
        )}

        <div className="space-y-3 border-t border-hairline pt-4">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <DateField label="Day" value={item.startDate} onChange={(d) => patch({ startDate: d })} />
            <input
              type="time"
              aria-label="Time"
              defaultValue={item.startTime ?? ""}
              onBlur={(e) => e.target.value !== (item.startTime ?? "") && patch({ startTime: e.target.value || null })}
              className="h-10 rounded-md border border-hairline-strong bg-deep px-2 text-[14px] text-ink outline-none focus:border-accent max-sm:h-12"
            />
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note.trim() !== (item.details.note ?? "") && patch({ note: note.trim() || null })}
            placeholder="Notes: what to order, who's coming, how to get there"
            rows={3}
            maxLength={2000}
            className="w-full resize-y rounded-md border border-hairline-strong bg-deep px-3 py-2 text-[13px] text-ink outline-none placeholder:text-stone focus:border-accent"
          />
          {saveError && <p className="text-[12px] text-danger">{saveError}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {suggested && (
              <Button size="sm" variant="primary" disabled={busy} onClick={() => patch({ status: "planned" })}>
                Keep
              </Button>
            )}
            {item.status === "planned" && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch({ status: "booked" })}>
                Mark booked
              </Button>
            )}
            {item.status === "booked" && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch({ status: "cancelled" })}>
                Mark cancelled
              </Button>
            )}
            <Button size="sm" variant="quiet" disabled={busy} onClick={remove} className="ml-auto">
              <Trash2 size={14} /> {suggested ? "Dismiss" : "Remove"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
