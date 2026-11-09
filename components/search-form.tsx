import { ArrowLeftRight, Search } from "lucide-react";
import { useSyncExternalStore } from "react";
import { addDays } from "@/lib/format";
import type { Cabin, MaxStops } from "@/lib/types";
import { AirportField } from "./airport-field";
import { DateRangeField } from "./date-picker";
import { Button, Toggle } from "./ui";

export type FormState = {
  from: string[];
  to: string[];
  depart: string;
  return: string | null;
  roundTrip: boolean;
  adults: number;
  cabin: Cabin;
  stops: MaxStops;
  bags: number;
  nearby: boolean;
  flexible: boolean;
  split: boolean;
};

/** Today's date where the traveller is, not in UTC. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

const noSubscribe = () => () => {};

/** The traveller's local date after hydration; the UTC date while server rendering. */
function useToday(): string {
  return useSyncExternalStore(noSubscribe, localToday, utcToday);
}

// UTC so the server render and the first browser render agree.
export function defaultForm(): FormState {
  const today = utcToday();
  const depart = addDays(today, 21);
  return { from: [], to: [], depart, return: addDays(depart, 5), roundTrip: true, adults: 1, cabin: "ECONOMY", stops: "ANY", bags: 0, nearby: true, flexible: true, split: true };
}

export function toQuery(f: FormState) {
  return {
    from: f.from,
    to: f.to,
    depart: f.depart,
    return: f.roundTrip ? f.return : null,
    cabin: f.cabin,
    stops: f.stops,
    adults: f.adults,
    bags: f.bags,
    nearby: f.nearby,
    flexible: f.flexible,
    split: f.split,
  };
}

const CABIN_LABEL: Record<Cabin, string> = { ECONOMY: "Economy", PREMIUM_ECONOMY: "Premium economy", BUSINESS: "Business", FIRST: "First" };
const STOP_LABEL: Record<MaxStops, string> = { ANY: "Any stops", "0": "Nonstop only", "1": "1 stop or fewer", "2": "2 stops or fewer" };

function Select<T extends string | number>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <label className="relative inline-flex">
      <span className="sr-only">{label}</span>
      <select
        value={String(value)}
        onChange={(e) => onChange(options.find(([v]) => String(v) === e.target.value)![0])}
        className="h-8 cursor-pointer appearance-none rounded-md border border-hairline-hover bg-card pl-3 pr-7 text-[13px] text-ink outline-none hover:border-hairline-hover max-sm:h-10"
      >
        {options.map(([v, l]) => (
          <option key={String(v)} value={String(v)}>
            {l}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-ash">▾</span>
    </label>
  );
}

export function SearchForm({
  form,
  onChange,
  onSubmit,
  busy,
  filters = {},
}: {
  form: FormState;
  onChange: (f: FormState) => void;
  onSubmit: () => void;
  busy: boolean;
  /** Saved preference filters, so calendar fares match the real search. */
  filters?: Record<string, unknown>;
}) {
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => onChange({ ...form, [k]: v });
  const today = useToday();
  const ready = form.from.length > 0 && form.to.length > 0 && form.depart >= today && (!form.roundTrip || (form.return && form.return >= form.depart));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !busy) onSubmit();
      }}
      className="rounded-xl border border-hairline-strong bg-card"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3 py-2.5">
        <div className="inline-flex rounded-md border border-hairline-strong p-0.5">
          {[true, false].map((rt) => (
            <button
              key={String(rt)}
              type="button"
              onClick={() => onChange({ ...form, roundTrip: rt, return: rt ? (form.return ?? addDays(form.depart, 5)) : form.return })}
              className={`h-7 cursor-pointer rounded-sm px-3 text-[13px] max-sm:h-9 ${form.roundTrip === rt ? "bg-elevated text-ink" : "text-mute hover:text-charcoal"}`}
            >
              {rt ? "Round trip" : "One way"}
            </button>
          ))}
        </div>
        <Select label="Travellers" value={form.adults} onChange={(v) => set("adults", v)} options={[1, 2, 3, 4, 5, 6].map((n) => [n, `${n} adult${n > 1 ? "s" : ""}`])} />
        <Select label="Cabin" value={form.cabin} onChange={(v) => set("cabin", v)} options={Object.entries(CABIN_LABEL) as [Cabin, string][]} />
        <Select label="Stops" value={form.stops} onChange={(v) => set("stops", v)} options={Object.entries(STOP_LABEL) as [MaxStops, string][]} />
        <Select label="Checked bags" value={form.bags} onChange={(v) => set("bags", v)} options={[[0, "No checked bag"], [1, "1 checked bag"], [2, "2 checked bags"]]} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr_minmax(0,0.9fr)]">
        <div className="flex items-stretch border-b border-hairline lg:border-b-0 lg:border-r">
          <AirportField label="From" value={form.from} onChange={(v) => set("from", v)} placeholder="City or airport" />
        </div>
        <div className="flex items-center justify-center max-lg:absolute max-lg:hidden">
          <button
            type="button"
            aria-label="Swap from and to"
            onClick={() => onChange({ ...form, from: form.to, to: form.from })}
            className="mx-1 flex size-8 cursor-pointer items-center justify-center rounded-full border border-hairline-strong bg-elevated text-charcoal hover:text-ink"
          >
            <ArrowLeftRight size={14} />
          </button>
        </div>
        <div className="flex items-stretch border-b border-hairline lg:border-b-0 lg:border-l lg:border-r">
          <AirportField label="To" value={form.to} onChange={(v) => set("to", v)} placeholder="City or airport" />
        </div>
        <DateRangeField
          depart={form.depart}
          ret={form.roundTrip ? form.return : null}
          roundTrip={form.roundTrip}
          today={today}
          onChange={(depart, ret) => onChange({ ...form, depart, return: form.roundTrip ? ret : form.return })}
          onRoundTrip={(rt) => onChange({ ...form, roundTrip: rt, return: rt ? (form.return && form.return >= form.depart ? form.return : addDays(form.depart, 5)) : form.return })}
          priceQuery={form.from.length && form.to.length ? { ...toQuery(form), ...filters } : null}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-hairline px-3 py-3">
        <span className="mr-1 text-xs text-ash">Hacks</span>
        <Toggle checked={form.nearby} onChange={(v) => set("nearby", v)} label="Nearby airports" hint="Also search airports within 150 km of yours" />
        <Toggle checked={form.flexible} onChange={(v) => set("flexible", v)} label="±3 days" hint="Check prices three days either side" />
        <Toggle checked={form.split} onChange={(v) => set("split", v)} label="Two one-ways" hint="Compare round trips with two separate one-way tickets" />
        <Button type="submit" variant="primary" disabled={!ready || busy} className="ml-auto max-sm:w-full">
          <Search size={15} />
          {busy ? "Searching…" : "Search flights"}
        </Button>
      </div>
    </form>
  );
}
