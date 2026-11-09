import { useMemo, useState } from "react";
import { airlineName } from "@/lib/airlines";
import { totalMinutes, totalStops, type Ranked } from "@/lib/hacks";
import { money, plural } from "@/lib/format";
import type { Itinerary } from "@/lib/types";
import { AirlineLogo } from "./logo";
import { ItineraryCard, displayPrice, type SellerCheck } from "./itinerary-card";
import { Button, Toggle } from "./ui";

type Sort = "best" | "cheapest" | "fastest";
const PAGE = 12;

export function Results({
  itineraries,
  labels,
  checks,
  onCheck,
  alt,
  highlight,
  trustedOnly,
  setTrustedOnly,
}: {
  itineraries: Itinerary[];
  labels: Ranked;
  checks: Record<string, SellerCheck>;
  onCheck: (it: Itinerary) => void;
  alt: Set<string>;
  highlight: string | null;
  trustedOnly: boolean;
  setTrustedOnly: (v: boolean) => void;
}) {
  const [sort, setSort] = useState<Sort>("best");
  const [nonstop, setNonstop] = useState(false);
  const [airlines, setAirlines] = useState<string[]>([]);
  const [limit, setLimit] = useState(PAGE);

  const carriers = useMemo(() => {
    const m = new Map<string, { name: string; min: number }>();
    for (const it of itineraries)
      for (const s of it.slices)
        for (const l of s.legs) {
          const cur = m.get(l.airline.code);
          if (!cur || it.price < cur.min) m.set(l.airline.code, { name: airlineName(l.airline.code, l.airline.name), min: it.price });
        }
    return [...m].sort((a, b) => a[1].min - b[1].min).slice(0, 10);
  }, [itineraries]);

  const shown = useMemo(() => {
    let list = itineraries;
    if (nonstop) list = list.filter((it) => totalStops(it) === 0);
    if (airlines.length) list = list.filter((it) => it.slices.every((s) => s.legs.every((l) => airlines.includes(l.airline.code))));
    if (trustedOnly) list = list.filter((it) => !(checks[it.id]?.state === "done" && (checks[it.id] as Extract<SellerCheck, { state: "done" }>).data.lowestTrusted === null));
    const price = (it: Itinerary) => displayPrice(it, checks[it.id], trustedOnly);
    if (sort === "cheapest") return [...list].sort((a, b) => price(a) - price(b));
    if (sort === "fastest") return [...list].sort((a, b) => totalMinutes(a) - totalMinutes(b) || price(a) - price(b));
    return list;
  }, [itineraries, nonstop, airlines, trustedOnly, sort, checks]);

  const badges = (it: Itinerary) => {
    const b: string[] = [];
    if (labels.best === it.id) b.push("Best");
    if (labels.cheapest === it.id) b.push("Cheapest");
    if (labels.fastest === it.id) b.push("Fastest");
    if (it.slices.some((s) => alt.has(s.legs[0].from) || alt.has(s.legs[s.legs.length - 1].to))) b.push("Nearby airport");
    if (it.slices.some((s) => s.self_transfer)) b.push("Self-transfer");
    return b;
  };

  return (
    <section aria-label="Flights" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border border-hairline-strong p-1 pointer-coarse:p-0" role="tablist">
          {(["best", "cheapest", "fastest"] as Sort[]).map((s) => (
            <button key={s} role="tab" aria-selected={sort === s} type="button" onClick={() => setSort(s)} className={`h-7 cursor-pointer rounded-sm px-3 text-[13px] capitalize pointer-coarse:h-11 ${sort === s ? "bg-elevated text-ink" : "text-mute hover:text-charcoal"}`}>
              {s}
            </button>
          ))}
        </div>
        <Toggle checked={trustedOnly} onChange={setTrustedOnly} label="Trusted sellers only" hint="Show prices from airlines and established agencies only" />
        <Toggle checked={nonstop} onChange={setNonstop} label="Nonstop" />
        <span className="ml-auto text-xs text-ash">{plural(shown.length, "flight")}</span>
      </div>

      {carriers.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {carriers.map(([code, c]) => {
            const on = airlines.includes(code);
            return (
              <button
                key={code}
                type="button"
                onClick={() => setAirlines(on ? airlines.filter((a) => a !== code) : [...airlines, code])}
                className={`inline-flex h-9 pointer-coarse:h-11 shrink-0 cursor-pointer items-center gap-2 rounded-full border pl-1 pr-3 text-[13px] ${on ? "border-hairline-hover bg-elevated text-ink" : "border-hairline-strong text-mute hover:text-charcoal"}`}
              >
                <AirlineLogo code={code} name={c.name} size={24} />
                {c.name}
                <span className="text-ash tnum">{money(c.min)}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="space-y-3">
        {shown.slice(0, limit).map((it) => (
          <ItineraryCard key={it.id} it={it} badges={badges(it)} check={checks[it.id]} onCheck={() => onCheck(it)} trustedOnly={trustedOnly} alt={alt} highlight={highlight === it.id} />
        ))}
        {!shown.length && <p className="rounded-lg border border-hairline-strong bg-card p-6 text-sm text-mute">No flights match these filters.</p>}
      </div>
      {shown.length > limit && (
        <div className="flex justify-center">
          <Button onClick={() => setLimit(limit + PAGE)}>Show {Math.min(PAGE, shown.length - limit)} more</Button>
        </div>
      )}
    </section>
  );
}
