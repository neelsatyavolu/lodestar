import { ChevronDown, Leaf, Plug, Wifi } from "lucide-react";
import { useState } from "react";
import { airlineName } from "@/lib/airlines";
import { clock, day, dayShift, duration, money, plural } from "@/lib/format";
import type { Itinerary, Leg, Slice } from "@/lib/types";
import type { Verified } from "@/lib/verify";
import { AirlineLogo } from "./logo";
import { SellersPanel, type OnBook } from "./sellers-panel";
import { Button, Pill, Spinner, StatusDot } from "./ui";

export type SellerCheck = { state: "loading" } | { state: "done"; data: Verified } | { state: "error"; error: string };

function airlinesOf(s: Slice): { code: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const l of s.legs) if (!seen.has(l.airline.code)) seen.set(l.airline.code, airlineName(l.airline.code, l.airline.name));
  return [...seen].map(([code, name]) => ({ code, name }));
}

export function allAirlines(it: Itinerary): { code: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const s of it.slices) for (const a of airlinesOf(s)) seen.set(a.code, a.name);
  return [...seen].map(([code, name]) => ({ code, name }));
}

function SliceRow({ slice, label, alt }: { slice: Slice; label?: string; alt: Set<string> }) {
  const first = slice.legs[0];
  const last = slice.legs[slice.legs.length - 1];
  const shift = dayShift(first.depart, last.arrive);
  const airlines = airlinesOf(slice);
  const via = slice.layovers.map((l) => l.airport).filter(Boolean).join(", ");
  return (
    <div className="grid grid-cols-[32px_1fr] items-center gap-x-3 gap-y-1 sm:grid-cols-[32px_minmax(150px,1.2fr)_1fr_1fr]">
      <div className="row-span-2 flex -space-x-2 sm:row-span-1">
        {airlines.slice(0, 2).map((a) => (
          <AirlineLogo key={a.code} code={a.code} name={a.name} size={airlines.length > 1 ? 22 : 28} />
        ))}
      </div>
      <div className="min-w-0">
        <div className="text-[15px] text-ink tnum">
          {clock(first.depart)} – {clock(last.arrive)}
          {shift > 0 && <sup className="ml-0.5 text-[10px] text-mute">+{shift}</sup>}
        </div>
        <div className="truncate text-xs text-ash">
          {label && <span className="text-mute">{label} · </span>}
          {day(first.depart)} · {airlines.map((a) => a.name).join(", ")}
        </div>
      </div>
      <div className="max-sm:hidden">
        <div className="text-sm text-body tnum">{duration(slice.minutes)}</div>
        <div className="font-mono text-xs text-ash">
          <span className={alt.has(first.from) ? "text-accent" : ""}>{first.from}</span>–<span className={alt.has(last.to) ? "text-accent" : ""}>{last.to}</span>
        </div>
      </div>
      <div className="max-sm:col-start-2">
        <div className="text-sm text-body">
          {slice.stops ? plural(slice.stops, "stop") : "Nonstop"}
          <span className="text-ash sm:hidden"> · {duration(slice.minutes)} · {first.from}–{last.to}</span>
        </div>
        {via && <div className="truncate font-mono text-xs text-ash">{via}</div>}
      </div>
    </div>
  );
}

function amenity(leg: Leg, key: string): boolean {
  return Boolean(leg.amenities && leg.amenities[key]);
}

function LegDetail({ leg }: { leg: Leg }) {
  return (
    <div className="flex gap-3">
      <AirlineLogo code={leg.airline.code} name={leg.airline.name} size={20} />
      <div className="min-w-0 flex-1 text-[13px]">
        <div className="text-ink tnum">
          {clock(leg.depart)} {leg.from_name ?? leg.from} <span className="font-mono text-ash">({leg.from})</span>
        </div>
        <div className="my-1 text-xs text-ash">
          {duration(leg.minutes)} · {airlineName(leg.airline.code, leg.airline.name)} <span className="font-mono">{leg.airline.code} {leg.flight_number}</span>
          {leg.operating && leg.operating.code !== leg.airline.code && <> · operated by {leg.operating.name}</>}
          {leg.aircraft && <> · {leg.aircraft}</>}
          {leg.legroom && <> · {leg.legroom} legroom</>}
        </div>
        <div className="text-ink tnum">
          {clock(leg.arrive)} {leg.to_name ?? leg.to} <span className="font-mono text-ash">({leg.to})</span>
        </div>
        <div className="mt-1 flex gap-3 text-xs text-ash">
          {amenity(leg, "wifi") && (
            <span className="inline-flex items-center gap-1">
              <Wifi size={12} /> Wi-Fi
            </span>
          )}
          {(amenity(leg, "power") || amenity(leg, "usb_power")) && (
            <span className="inline-flex items-center gap-1">
              <Plug size={12} /> Power
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function SliceDetail({ slice, label }: { slice: Slice; label: string }) {
  return (
    <div>
      <div className="mb-3 text-xs text-ash">
        {label} · {day(slice.legs[0].depart)} · {duration(slice.minutes)}
        {slice.co2_kg && (
          <span className="ml-2 inline-flex items-center gap-1">
            <Leaf size={11} /> {slice.co2_kg} kg CO₂{slice.co2_delta_pct !== null && ` (${slice.co2_delta_pct > 0 ? "+" : ""}${slice.co2_delta_pct}% vs typical)`}
          </span>
        )}
      </div>
      <div className="space-y-3">
        {slice.legs.map((leg, i) => (
          <div key={`${leg.flight_number}-${i}`}>
            <LegDetail leg={leg} />
            {slice.layovers[i] && (
              <div className={`my-3 ml-8 flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${hardLayover(slice.layovers[i]) ? "border-warn/40 text-body" : "border-hairline text-mute"}`}>
                {hardLayover(slice.layovers[i]) && <StatusDot state="warn" />}
                {duration(slice.layovers[i].minutes)} layover in {slice.layovers[i].city ?? slice.layovers[i].airport}
                {slice.layovers[i].overnight && " · overnight"}
                {slice.layovers[i].change_of_airport && " · change airports"}
                {slice.layovers[i].minutes < 60 && " · tight connection"}
              </div>
            )}
          </div>
        ))}
      </div>
      {slice.self_transfer && (
        <p className="mt-3 flex items-start gap-2 text-xs text-body">
          <StatusDot state="warn" className="mt-1" />
          Self-transfer: separate tickets. You collect and re-check bags, and a missed connection is on you.
        </p>
      )}
    </div>
  );
}

function hardLayover(l: Slice["layovers"][number]): boolean {
  return l.minutes < 60 || l.overnight || l.change_of_airport;
}

function SellerLine({ check, googlePrice, trustedOnly }: { check?: SellerCheck; googlePrice: number; trustedOnly: boolean }) {
  if (!check) return <div className="text-[12px] text-ash">Sellers not checked</div>;
  if (check.state === "loading")
    return (
      <div className="inline-flex items-center gap-2 text-[12px] text-ash">
        <Spinner className="!size-2.5" /> Checking sellers
      </div>
    );
  if (check.state === "error") return <div className="text-[12px] text-ash">Couldn&apos;t check sellers</div>;
  const v = check.data;
  if (v.lowestTrusted === null)
    return (
      <div className="inline-flex items-center gap-2 text-[12px] text-charcoal">
        <StatusDot state="warn" className="!size-1.5" /> Only unvetted agencies
      </div>
    );
  const airline = v.sellers.find((s) => s.tier === "airline" && s.lowest === v.lowestTrusted);
  const label = airline ? "Airline direct" : v.trustedSeller;
  const differs = trustedOnly && Math.round(v.lowestTrusted) !== Math.round(googlePrice);
  return (
    <div className="inline-flex items-center justify-end gap-2 text-[12px] text-charcoal">
      <StatusDot state={differs ? "warn" : "ok"} className="!size-1.5" />
      {label}
      {differs && v.lowestTrusted > googlePrice && <span className="text-ash"> · {money(googlePrice)} elsewhere</span>}
    </div>
  );
}

export function displayPrice(it: Itinerary, check: SellerCheck | undefined, trustedOnly: boolean): number {
  if (trustedOnly && check?.state === "done" && check.data.lowestTrusted !== null) return check.data.lowestTrusted;
  return it.price;
}

export function ItineraryCard({
  it,
  badges,
  check,
  onCheck,
  trustedOnly,
  alt,
  highlight,
  onBook,
}: {
  it: Itinerary;
  badges: string[];
  check?: SellerCheck;
  onCheck: () => void;
  trustedOnly: boolean;
  alt: Set<string>;
  highlight?: boolean;
  /** Only offered when the exact flights can be read again later. */
  onBook?: OnBook;
}) {
  const [open, setOpen] = useState(false);
  const price = displayPrice(it, check, trustedOnly);
  const toggle = () => {
    if (!open && !check) onCheck();
    setOpen(!open);
  };
  return (
    <article id={`it-${it.id}`} className={`rounded-lg border bg-card transition-colors ${highlight ? "border-hairline-hover" : "border-hairline-strong hover:border-hairline-hover"}`}>
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full cursor-pointer items-center gap-4 p-4 text-left">
        <div className="min-w-0 flex-1 space-y-3">
          {badges.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {badges.map((b) => (
                <Pill key={b} tone={b === "Best" ? "accent" : "neutral"} dot={b === "Self-transfer" ? "warn" : undefined}>
                  {b}
                </Pill>
              ))}
            </div>
          )}
          {it.slices.map((s, i) => (
            <SliceRow key={i} slice={s} label={it.slices.length > 1 ? (i === 0 ? "Out" : "Back") : undefined} alt={alt} />
          ))}
        </div>
        <div className="w-28 shrink-0 text-right">
          <div className="text-xl text-ink tnum">{money(price)}</div>
          <div className="text-[12px] text-ash">{it.slices.length > 1 ? "round trip" : "one way"}</div>
          <div className="mt-1">
            <SellerLine check={check} googlePrice={it.price} trustedOnly={trustedOnly} />
          </div>
        </div>
        <ChevronDown size={16} className={`shrink-0 text-ash transition-transform max-sm:hidden ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="grid gap-6 border-t border-hairline p-4 lg:grid-cols-2">
          <div className="space-y-6">
            {it.slices.map((s, i) => (
              <SliceDetail key={i} slice={s} label={it.slices.length > 1 ? (i === 0 ? "Outbound" : "Return") : "Flight"} />
            ))}
          </div>
          <div>
            <div className="mb-2 text-xs text-ash">Who sells this</div>
            {!check && <Button onClick={onCheck}>Check sellers</Button>}
            {check?.state === "loading" && (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton h-12 rounded-md" />
                ))}
                <p className="text-xs text-ash">Reading the live booking page for this exact itinerary…</p>
              </div>
            )}
            {check?.state === "error" && (
              <div className="space-y-2 text-sm text-mute">
                <p>{check.error}</p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={onCheck}>Try again</Button>
                  <a href={it.booking_url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 pointer-coarse:h-11 items-center px-3 text-[13px] text-accent hover:underline">
                    Open on Google Flights
                  </a>
                </div>
              </div>
            )}
            {check?.state === "done" && <SellersPanel verified={check.data} trustedOnly={trustedOnly} onBook={it.tfs ? onBook : undefined} />}
          </div>
        </div>
      )}
    </article>
  );
}
