import { Search } from "lucide-react";
import { useRef, useState } from "react";
import { ApiError, post } from "@/lib/client";
import { addDays, day, plural } from "@/lib/format";
import type { FlexSaving } from "@/lib/stays/flex";
import type { VerifiedOffer } from "@/lib/stays/offers";
import { MAX_ADULTS, MAX_NIGHTS, nights, type Hotel, type StaysSearch } from "@/lib/stays/types";
import { StayCard, type OfferCheck } from "./stay-card";
import { Button } from "./ui";

// Stays: hotel search over Google Hotels, with every seller's price checked
// and the same trust tiers as flights. Each search also tries arriving a
// night earlier or later, in the background.

/** `id` changes with every search, so late answers from an older one are dropped. */
type Result = { id: number; query: StaysSearch; hotels: Hotel[]; url: string };
type Flex = { state: "loading" } | { state: "done"; savings: Record<string, FlexSaving> } | { state: "error" };

const inputClass = "h-11 w-full rounded-md border border-hairline-hover bg-card px-3 text-[15px] text-ink outline-none focus:border-accent";
const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";

function defaultStay(): StaysSearch {
  const checkin = addDays(new Date().toISOString().slice(0, 10), 21);
  return { city: "", checkin, checkout: addDays(checkin, 3), adults: 2 };
}

export function Stays({ trustedOnly }: { trustedOnly: boolean }) {
  const [form, setForm] = useState<StaysSearch>(defaultStay);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, OfferCheck>>({});
  const [flex, setFlex] = useState<Flex | null>(null);
  const running = useRef<AbortController | null>(null);
  // Seller checks belong to the results on screen: a new result set aborts the old ones.
  const generation = useRef(0);
  const checking = useRef<AbortController>(new AbortController());

  const today = new Date().toISOString().slice(0, 10);
  const stayNights = nights(form);
  const ready = form.city.trim().length >= 2 && form.checkin >= today && stayNights >= 1 && stayNights <= MAX_NIGHTS;

  const search = async (q: StaysSearch) => {
    running.current?.abort();
    const ctrl = new AbortController();
    running.current = ctrl;
    setBusy(true);
    setError(null);
    try {
      const data = await post<{ hotels: Hotel[]; url: string }>("/api/stays/search", q, ctrl.signal);
      const id = ++generation.current;
      checking.current.abort();
      checking.current = new AbortController();
      setChecks({});
      setResult({ id, query: q, ...data });
      setFlex({ state: "loading" });
      post<{ savings: Record<string, FlexSaving> }>("/api/stays/flex", q, checking.current.signal)
        .then((r) => setFlex({ state: "done", savings: r.savings }))
        .catch((err) => !isAbort(err) && setFlex({ state: "error" }));
    } catch (err) {
      if (!isAbort(err)) setError(errorText(err, "The hotel search failed. Try again."));
    } finally {
      if (running.current === ctrl) setBusy(false);
    }
  };

  /** Seller prices for one hotel of the results `id`; dropped once newer results are on screen. */
  const check = async (id: number, q: StaysSearch, key: string) => {
    const current = () => generation.current === id;
    setChecks((c) => ({ ...c, [key]: { state: "loading" } }));
    try {
      const r = await post<{ offers: VerifiedOffer[]; url: string }>("/api/stays/prices", { key, checkin: q.checkin, checkout: q.checkout, adults: q.adults }, checking.current.signal);
      if (current()) setChecks((c) => ({ ...c, [key]: { state: "done", offers: r.offers, url: r.url } }));
    } catch (err) {
      if (current() && !isAbort(err)) setChecks((c) => ({ ...c, [key]: { state: "error", error: errorText(err, "Couldn't read this hotel's prices.") } }));
    }
  };

  const shift = (s: FlexSaving) => {
    if (!result) return;
    const next = { ...result.query, checkin: s.checkin, checkout: s.checkout };
    setForm(next);
    search(next);
  };

  const savings = flex?.state === "done" ? flex.savings : {};
  const found = result ? Object.keys(savings).length : 0;

  return (
    <section className={result ? "pt-8 pb-6" : "pt-20 pb-10 sm:pt-28"}>
      {!result && (
        <div className="mb-10 max-w-4xl">
          <h1 className="font-display text-[clamp(44px,6.5vw,72px)]">
            Hotels too.
            <br />
            <span className="text-charcoal">Same sellers you can trust.</span>
          </h1>
          <p className="mt-6 max-w-xl text-[18px] leading-relaxed text-body">
            Live prices from Google Hotels, checked seller by seller with taxes included. Every search also tries arriving a night earlier or later, and shows what a refundable rate costs.
          </p>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !busy) search({ ...form, city: form.city.trim() });
        }}
        className="grid grid-cols-2 items-end gap-3 rounded-xl border border-hairline-strong bg-card p-3 sm:grid-cols-[minmax(0,1.6fr)_1fr_1fr_auto_auto]"
      >
        <label className="col-span-2 space-y-1 sm:col-span-1">
          <span className="text-xs text-ash">Where</span>
          <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="City or neighborhood" maxLength={80} className={inputClass} autoComplete="off" />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-ash">Check in</span>
          <input
            type="date"
            value={form.checkin}
            min={today}
            onChange={(e) => {
              const checkin = e.target.value;
              // Keep the same length of stay when the check-in moves.
              setForm({ ...form, checkin, checkout: checkin && stayNights >= 1 ? addDays(checkin, stayNights) : form.checkout });
            }}
            className={inputClass}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-ash">Check out</span>
          <input type="date" value={form.checkout} min={form.checkin ? addDays(form.checkin, 1) : today} onChange={(e) => setForm({ ...form, checkout: e.target.value })} className={inputClass} />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-ash">Guests</span>
          <select value={form.adults} onChange={(e) => setForm({ ...form, adults: Number(e.target.value) })} className={`${inputClass} cursor-pointer pr-8`}>
            {Array.from({ length: MAX_ADULTS }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {plural(n, "adult")}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="primary" disabled={!ready || busy} className="!h-11">
          <Search size={15} /> {busy ? "Searching…" : "Search"}
        </Button>
        {stayNights > MAX_NIGHTS && <p className="col-span-2 text-[13px] text-danger sm:col-span-5">Stays are up to {MAX_NIGHTS} nights.</p>}
      </form>

      {error && <p className="mt-4 rounded-lg border border-danger/40 bg-card p-4 text-[13px] text-danger">{error}</p>}

      {result && (
        <div className="mt-8 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[18px] text-ink">
              {plural(result.hotels.length, "stay")} in {result.query.city}
              <span className="ml-2 text-[14px] text-mute">
                {day(result.query.checkin)} – {day(result.query.checkout)} · {plural(nights(result.query), "night")} · one room for {plural(result.query.adults, "adult")}
              </span>
            </h2>
            <p className="text-xs text-ash">
              {flex?.state === "loading" && "Checking a night earlier and later…"}
              {flex?.state === "done" && (found ? `${plural(found, "stay")} cost less a night earlier or later.` : "Moving a night doesn't save much here.")}
              {flex?.state === "error" && "Couldn't check nearby dates."}
            </p>
          </div>
          <p className="text-xs text-ash">Prices are Google&apos;s lowest per night before taxes. Open a stay for every seller&apos;s price with taxes and fees.</p>
          <div className="space-y-3">
            {result.hotels.map((h) => (
              <StayCard key={`${result.id}:${h.key}`} hotel={h} nights={nights(result.query)} check={checks[h.key]} onCheck={() => check(result.id, result.query, h.key)} saving={savings[h.key]} onShift={shift} trustedOnly={trustedOnly} />
            ))}
          </div>
          <a href={result.url} target="_blank" rel="noopener noreferrer" className="inline-block text-[13px] text-mute hover:text-ink">
            See more on Google Hotels
          </a>
        </div>
      )}
    </section>
  );
}
