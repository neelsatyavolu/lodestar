import { ChevronLeft, ChevronRight, Clock, ExternalLink, Globe, MapPin, MapPinOff, Phone, Star, Trash2, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/client";
import type { Item } from "@/lib/journeys/types";
import { mapsSearchUrl, type LatLng, type PlaceDetails, type Suggestion } from "@/lib/places/types";
import { Button, Pill, Spinner } from "../ui";
import { DateField } from "./date-field";
import { photoUrl, usePlace } from "./place-cache";
import { PlaceSearch } from "./place-search";
import { errorText, time12 } from "./shared";

// Everything about one stop: Google's view of the place (photo, rating, price,
// hours, phone, site) above, and the trip's own facts (when, confirmation,
// note) below, editable in place.

const WEEKDAY = new Date().toLocaleDateString("en-US", { weekday: "long" });

function GooglePart({ place }: { place: PlaceDetails }) {
  const [allHours, setAllHours] = useState(false);
  const today = place.hours.find((h) => h.startsWith(WEEKDAY));
  return (
    <div className="space-y-2.5 text-[13px] text-body">
      {place.photos[0] && (
        // eslint-disable-next-line @next/next/no-img-element -- a redirect to Google's image host; next/image can't proxy it.
        <img src={photoUrl(place.photos[0])} alt="" className="h-44 w-full rounded-lg bg-elevated object-cover outline outline-1 -outline-offset-1 outline-hairline-strong" loading="lazy" />
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
              {today ?? "Hours"} <span className="text-accent">{allHours ? "Hide times" : "Show times"}</span>
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

const q = (s: string) => encodeURIComponent(s.trim());

/** Search links on other sites: no API, just the place's name and town. */
function OpenIn({ item, place }: { item: Item; place: PlaceDetails | null }) {
  const name = place?.name ?? item.title;
  const where = place?.address ?? item.details.address ?? item.place ?? "";
  const links = [
    { label: "Google Maps", href: place?.mapsUrl ?? item.details.url ?? mapsSearchUrl(`${name} ${where}`) },
    { label: "Google", href: `https://www.google.com/search?q=${q(`${name} ${where}`)}` },
    { label: "Yelp", href: `https://www.yelp.com/search?find_desc=${q(name)}&find_loc=${q(where)}` },
    { label: "Tripadvisor", href: `https://www.tripadvisor.com/Search?q=${q(`${name} ${where}`)}` },
  ];
  return (
    <div>
      <p className="mb-1.5 text-[12px] text-mute">Open in</p>
      <div className="flex flex-wrap gap-1.5">
        {links.map((l) => (
          <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1 rounded-md border border-hairline-strong bg-elevated px-2.5 text-[12px] text-ink hover:border-hairline-hover">
            {l.label} <ExternalLink size={11} className="text-ash" aria-hidden />
          </a>
        ))}
      </div>
    </div>
  );
}

function Photos({ place }: { place: PlaceDetails }) {
  if (!place.photos.length) return <p className="text-[13px] text-mute">No photos for this place.</p>;
  return (
    <div className="grid grid-cols-2 gap-2">
      {place.photos.slice(0, 8).map((p) => (
        // eslint-disable-next-line @next/next/no-img-element -- a redirect to Google's image host; next/image can't proxy it.
        <img key={p} src={photoUrl(p, 480)} alt="" loading="lazy" className="aspect-[4/3] w-full rounded-lg bg-elevated object-cover outline outline-1 -outline-offset-1 outline-hairline-strong" />
      ))}
    </div>
  );
}

function Reviews({ item, place }: { item: Item; place: PlaceDetails | null }) {
  const name = place?.name ?? item.title;
  const where = place?.address ?? item.place ?? "";
  return (
    <div className="space-y-3 text-[13px] text-body">
      {place?.rating != null && (
        <p className="flex items-center gap-2 text-ink">
          <Star size={15} className="fill-warn text-warn" aria-hidden /> <span className="text-[18px] font-medium">{place.rating.toFixed(1)}</span>
          {place.ratingCount !== null && <span className="text-mute">from {place.ratingCount.toLocaleString()} Google reviews</span>}
        </p>
      )}
      <p className="text-mute">Read what people say:</p>
      <ul className="space-y-1.5">
        {[
          { label: "Google reviews", href: place?.mapsUrl ?? mapsSearchUrl(`${name} ${where}`) },
          { label: "Yelp", href: `https://www.yelp.com/search?find_desc=${q(name)}&find_loc=${q(where)}` },
          { label: "Tripadvisor", href: `https://www.tripadvisor.com/Search?q=${q(`${name} ${where}`)}` },
        ].map((l) => (
          <li key={l.label}>
            <a href={l.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
              {l.label} <ExternalLink size={11} aria-hidden />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Pins an item to a place picked from search: for one whose place wasn't found, or a wrong pin. */
function PinPicker({ item, near, onPinned, onCancel }: { item: Item; near: LatLng | null; onPinned: (i: Item) => void; onCancel?: () => void }) {
  const pin = async (s: Suggestion, place: PlaceDetails | null) => {
    const location = place?.location ?? s.location;
    if (!location) throw new Error("That place has no location. Try another.");
    const address = (place?.address ?? s.address)?.slice(0, 240) ?? null;
    const { item: next } = await api<{ item: Item }>(`/api/journeys/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ location: { placeId: s.id, lat: location.lat, lng: location.lng, address } }) });
    onPinned(next);
  };
  return (
    <div className="space-y-2">
      <PlaceSearch near={near} label={`Find ${item.title} on the map`} placeholder="Search for the place" initial={item.title} autoFocus={Boolean(onCancel)} onPick={pin} />
      {onCancel && (
        <button type="button" onClick={onCancel} className="cursor-pointer text-[12px] text-mute hover:text-ink">
          Keep the current pin
        </button>
      )}
    </div>
  );
}

export type Pager = { index: number; total: number; go: (index: number) => void };

/** `bare`: inside a sheet that already shows the name and a close button. `near`: where to search when pinning it. `pager`: steps through the day's stops. */
export function PlacePanel({ item, near, onClose, onChanged, onRemoved, bare = false, pager }: { item: Item; near: LatLng | null; onClose: () => void; onChanged: (i: Item) => void; onRemoved: () => void; bare?: boolean; pager?: Pager }) {
  const [repin, setRepin] = useState(false);
  const [view, setView] = useState<"about" | "reviews" | "photos">("about");
  const pinned = item.details.lat !== undefined;
  const canPin = item.kind !== "note" && item.kind !== "flight";
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
      {item.status === "booked" ? "Booked" : suggested ? "Idea" : item.status === "cancelled" ? "Cancelled" : item.details.reserve ? "To book" : "Planned"}
      {item.startTime && ` · ${time12(item.startTime)}`}
      {item.confirmation && <span className="font-mono"> · {item.confirmation}</span>}
    </>
  );
  return (
    <div className="flex max-h-full flex-col">
      {!bare && (
        <div className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[16px] font-medium text-ink">{place?.name ?? item.title}</h2>
            <p className="mt-0.5 text-[12px] text-mute">{status}</p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {pager && <PagerButtons pager={pager} />}
            <button type="button" onClick={onClose} aria-label="Close details" className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-ash hover:text-ink">
              <X size={16} />
            </button>
          </div>
        </div>
      )}
      {place && (
        <div className="flex shrink-0 gap-1 border-b border-hairline px-3" role="tablist" aria-label="Place details">
          {(["about", "reviews", "photos"] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`relative h-10 cursor-pointer px-2.5 text-[13px] capitalize ${view === v ? "text-ink" : "text-mute hover:text-charcoal"}`}>
              {v}
              <span className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full ${view === v ? "bg-accent" : "bg-transparent"}`} aria-hidden />
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {bare && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] text-mute">{status}</p>
            {pager && <PagerButtons pager={pager} />}
          </div>
        )}
        {place && view === "photos" && <Photos place={place} />}
        {view === "reviews" && <Reviews item={item} place={place} />}
        {canPin && !pinned && (
          <div className="space-y-2 rounded-lg border border-dashed border-hairline-strong p-3">
            <p className="flex items-center gap-2 text-[13px] text-body">
              <MapPinOff size={14} className="shrink-0 text-ash" aria-hidden /> Not on the map yet. Pick the place to pin it.
            </p>
            <PinPicker item={item} near={near} onPinned={onChanged} />
          </div>
        )}
        {canPin && pinned && repin && <PinPicker item={item} near={near} onPinned={(i) => (setRepin(false), onChanged(i))} onCancel={() => setRepin(false)} />}
        {loading && <Spinner />}
        {error && <p className="text-[12px] text-mute">{error}</p>}
        {view !== "about" ? null : place ? (
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
            </div>
          )
        )}

        {view === "about" && <OpenIn item={item} place={place} />}

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
          {canPin && pinned && !repin && (
            <button type="button" onClick={() => setRepin(true)} className="cursor-pointer text-[12px] text-mute hover:text-ink">
              Wrong place on the map? Change it
            </button>
          )}
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
            {item.status === "planned" && item.kind !== "note" && (
              <Button size="sm" variant="quiet" disabled={busy} onClick={() => patch({ facts: item.details.reserve ? { reserve: null, bookBy: null } : { reserve: true } })}>
                {item.details.reserve ? "Doesn't need booking" : "Needs booking"}
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

function PagerButtons({ pager }: { pager: Pager }) {
  return (
    <span className="inline-flex items-center text-[12px] text-mute">
      <button type="button" onClick={() => pager.go(pager.index - 1)} aria-label="Previous stop" className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-ash hover:text-ink">
        <ChevronLeft size={15} />
      </button>
      <span className="tnum px-0.5">
        {pager.index + 1} of {pager.total}
      </span>
      <button type="button" onClick={() => pager.go(pager.index + 1)} aria-label="Next stop" className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-ash hover:text-ink">
        <ChevronRight size={15} />
      </button>
    </span>
  );
}
