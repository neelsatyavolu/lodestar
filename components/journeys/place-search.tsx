import { BedDouble, MapPin, Plane, Search, StickyNote, UtensilsCrossed } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { LatLng, PlaceDetails, Suggestion } from "@/lib/places/types";
import { Spinner } from "../ui";
import { errorText } from "./shared";

// Search as you type for a place, biased to where the trip is: pick with the
// mouse or the arrow keys. Used to add a place to a day and to pin an item
// whose place wasn't found. A Google pick fetches the place's details (which
// also closes Google's billing session); OpenStreetMap rows carry their own.

const DEBOUNCE_MS = 200;

function KindIcon({ s }: { s: Suggestion }) {
  const Icon = s.category === "Airport" ? Plane : s.kind === "dining" ? UtensilsCrossed : s.kind === "stay" ? BedDouble : MapPin;
  return <Icon size={14} className="mt-0.5 shrink-0 text-ash" aria-hidden />;
}

/** The query's words in bold within a result's name, as search lists do. */
function Highlight({ text, q }: { text: string; q: string }) {
  const words = q.trim().split(/\s+/).filter((w) => w.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${words.join("|")})`, "gi"));
  return <>{parts.map((p, i) => (i % 2 ? <strong key={i} className="font-semibold text-ink">{p}</strong> : <span key={i}>{p}</span>))}</>;
}

type Props = {
  near: LatLng | null;
  label: string;
  placeholder: string;
  initial?: string;
  autoFocus?: boolean;
  /** Offer "Add … as a note" below the results. */
  onNote?: (text: string) => Promise<void>;
  onPick: (s: Suggestion, place: PlaceDetails | null) => Promise<void>;
};

export function PlaceSearch({ near, label, placeholder, initial = "", autoFocus = false, onNote, onPick }: Props) {
  const [q, setQ] = useState(initial);
  const [results, setResults] = useState<{ q: string; rows: Suggestion[]; provider: string } | null>(null);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(autoFocus && initial.length > 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const listId = `places-${useId().replace(/:/g, "")}`;
  const text = q.trim();
  // A fresh object each render; searches re-run only when the place itself moves.
  const nearKey = near ? `${near.lat.toFixed(4)},${near.lng.toFixed(4)}` : "";

  useEffect(() => {
    if (text.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      session.current ??= crypto.randomUUID();
      const params = new URLSearchParams({ q: text, session: session.current });
      if (nearKey) {
        const [lat, lng] = nearKey.split(",");
        params.set("lat", lat);
        params.set("lng", lng);
      }
      setSearching(true);
      api<{ suggestions: Suggestion[]; provider: string }>(`/api/places/search?${params}`, { signal: ctrl.signal })
        .then((r) => {
          setResults({ q: text, rows: r.suggestions, provider: r.provider });
          setActive(0);
          setError(null);
        })
        .catch((err) => !ctrl.signal.aborted && setError(errorText(err, "Search isn't working right now.")))
        .finally(() => !ctrl.signal.aborted && setSearching(false));
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [text, nearKey]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open]);

  const reset = () => {
    setQ("");
    setSearching(false);
    setResults(null);
    setOpen(false);
    session.current = null;
  };

  const choose = async (s: Suggestion | null) => {
    setBusy(true);
    setError(null);
    try {
      if (!s) await onNote?.(text);
      else {
        const place = s.id.startsWith("g:") ? (await api<{ place: PlaceDetails }>(`/api/places/details?id=${encodeURIComponent(s.id)}&session=${session.current ?? ""}`)).place : null;
        await onPick(s, place);
      }
      reset();
    } catch (err) {
      setError(errorText(err, "Couldn't add that."));
    } finally {
      setBusy(false);
    }
  };

  // Rows for an older query stay up while the next one loads, so the list doesn't flicker.
  const rows = text.length >= 2 ? (results?.rows ?? []) : [];
  const options: (Suggestion | null)[] = text.length >= 2 ? [...rows, ...(onNote ? [null] : [])] : [];
  const nothing = text.length >= 2 && results?.q === text && !rows.length && !searching;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return reset();
    if (!options.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + options.length) % options.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(options[active] ?? null);
    }
  };

  return (
    <div ref={root} className="relative">
      <div className="flex h-11 items-center gap-2 rounded-lg border border-hairline bg-card px-3 focus-within:border-accent">
        <Search size={15} className="shrink-0 text-ash" aria-hidden />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setError(null);
            // A search cut short by deleting text never finishes; don't leave its spinner up.
            if (e.target.value.trim().length < 2) setSearching(false);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={placeholder}
          aria-label={label}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-activedescendant={open && options.length ? `${listId}-${active}` : undefined}
          autoFocus={autoFocus}
          // The box around it shows focus; the page-wide ring would draw a second one inside.
          style={{ boxShadow: "none" }}
          className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-stone"
          disabled={busy}
        />
        {(searching || busy) && <Spinner />}
      </div>
      {error && <p className="mt-1 text-[12px] text-danger">{error}</p>}
      {open && (options.length > 0 || nothing) && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-hairline-strong bg-card shadow-[0_12px_32px_rgba(0,0,0,0.35)]">
          {nothing && <p className="px-3 py-2.5 text-[13px] text-mute">No places match “{text}”. Try the name and the city.</p>}
          <ul id={listId} role="listbox" className="max-h-[340px] overflow-y-auto py-1">
            {options.map((s, i) => (
              <li key={s?.id ?? "note"} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(s)}
                  className={`flex w-full cursor-pointer items-start gap-2.5 px-3 py-2 text-left ${i === active ? "bg-hover" : ""}`}
                >
                  {s ? <KindIcon s={s} /> : <StickyNote size={14} className="mt-0.5 shrink-0 text-ash" aria-hidden />}
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] text-body">{s ? <Highlight text={s.name} q={text} /> : `Add “${text}” as a note`}</span>
                    {s && (s.category || s.secondary) && <span className="block truncate text-[12px] text-mute">{[s.category, s.secondary].filter(Boolean).join(" · ")}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {rows.length > 0 && <p className="border-t border-hairline px-3 py-1.5 text-right text-[11px] text-ash">{results?.provider === "google" ? "Results from Google Maps" : "Results from OpenStreetMap"}</p>}
        </div>
      )}
    </div>
  );
}
