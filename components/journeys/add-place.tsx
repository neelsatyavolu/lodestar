import { MapPin, StickyNote } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, post } from "@/lib/client";
import { addDays } from "@/lib/format";
import type { LatLng, PlaceDetails, Suggestion } from "@/lib/places/types";
import { Spinner } from "../ui";
import { errorText } from "./shared";

// "Add a place" at the foot of each day: search as you type (biased to the
// trip), pick with the mouse or arrow keys, or keep the text as a note.

const DEBOUNCE_MS = 220;

export function AddPlace({ journeyId, date, near, onAdded }: { journeyId: string; date: string; near: LatLng | null; onAdded: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      session.current ??= crypto.randomUUID();
      const params = new URLSearchParams({ q: text, session: session.current });
      if (near) {
        params.set("lat", String(near.lat));
        params.set("lng", String(near.lng));
      }
      setSearching(true);
      api<{ suggestions: Suggestion[] }>(`/api/places/search?${params}`, { signal: ctrl.signal })
        .then((r) => {
          setResults(r.suggestions);
          setActive(0);
        })
        .catch((err) => !ctrl.signal.aborted && setError(errorText(err, "Search isn't working right now.")))
        .finally(() => !ctrl.signal.aborted && setSearching(false));
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, near]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open]);

  const reset = () => {
    setQ("");
    setResults([]);
    setOpen(false);
    session.current = null;
  };

  const add = async (s: Suggestion | null) => {
    setAdding(true);
    setError(null);
    try {
      if (!s) {
        await post(`/api/journeys/${journeyId}/items`, { kind: "note", status: "planned", title: q.trim().slice(0, 160), startDate: date });
      } else {
        // A Google pick has no location yet: its details call also closes the search session.
        const place = s.id.startsWith("g:") ? (await api<{ place: PlaceDetails }>(`/api/places/details?id=${encodeURIComponent(s.id)}&session=${session.current ?? ""}`)).place : null;
        const location = place?.location ?? s.location;
        const address = place?.address ?? s.address;
        await post(`/api/journeys/${journeyId}/items`, {
          kind: place?.kind ?? s.kind,
          status: "planned",
          title: (place?.name ?? s.name).slice(0, 160),
          startDate: date,
          // A stay picked here starts as one night; the details panel changes the dates.
          endDate: (place?.kind ?? s.kind) === "stay" ? addDays(date, 1) : null,
          place: s.secondary.split(",")[0]?.trim() || null,
          details: {
            placeId: s.id,
            ...(address ? { address: address.slice(0, 240) } : {}),
            ...(location ? { lat: location.lat, lng: location.lng, locatedAt: Date.now() } : {}),
            ...(place?.mapsUrl ? { url: place.mapsUrl } : {}),
            ...(place?.rating ? { rating: place.rating } : {}),
          },
        });
      }
      reset();
      onAdded();
    } catch (err) {
      setError(errorText(err, "Couldn't add that."));
    } finally {
      setAdding(false);
    }
  };

  const options = q.trim().length >= 2 ? [...results.map((r) => ({ kind: "place" as const, r })), { kind: "note" as const, r: null }] : [];
  const onKey = (e: React.KeyboardEvent) => {
    if (!options.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + options.length) % options.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      add(options[active]?.r ?? null);
    } else if (e.key === "Escape") reset();
  };

  return (
    <div ref={root} className="relative mt-2">
      <div className="flex h-11 items-center gap-2 rounded-lg border border-hairline bg-card px-3 focus-within:border-hairline-hover focus-within:shadow-[0_0_0_3px_var(--ring)]">
        <MapPin size={15} className="shrink-0 text-ash" aria-hidden />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setError(null);
            if (e.target.value.trim().length < 2) setResults([]);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder="Add a place"
          aria-label={`Add a place on ${date}`}
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-controls={`add-${date}`}
          className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-stone focus-visible:shadow-none"
          disabled={adding}
        />
        {(searching || adding) && <Spinner />}
      </div>
      {error && <p className="mt-1 text-[12px] text-danger">{error}</p>}
      {open && options.length > 0 && (
        <ul id={`add-${date}`} role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-hairline-strong bg-card py-1">
          {options.map((o, i) => (
            <li key={o.r?.id ?? "note"} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => add(o.r)}
                className={`flex w-full cursor-pointer items-start gap-2.5 px-3 py-2 text-left ${i === active ? "bg-hover" : ""}`}
              >
                {o.r ? <MapPin size={14} className="mt-0.5 shrink-0 text-ash" /> : <StickyNote size={14} className="mt-0.5 shrink-0 text-ash" />}
                <span className="min-w-0">
                  <span className="block truncate text-[14px] text-ink">{o.r ? o.r.name : `Add “${q.trim()}” as a note`}</span>
                  {o.r?.secondary && <span className="block truncate text-[12px] text-mute">{o.r.secondary}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
