import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  addDaysIso,
  addMonths,
  cheapestDay,
  dayOfMonth,
  longLabel,
  monthGrid,
  monthLabel,
  monthStart,
  nightsBetween,
  pick,
  shortLabel,
  type Iso,
  type Phase,
} from "@/lib/calendar";
import { post } from "@/lib/client";
import type { DayPrice } from "@/lib/types";
import { Button, Spinner } from "./ui";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MAX_AHEAD_DAYS = 330; // Google sells about 11 months out
const DEFAULT_NIGHTS = 5;

/** The search the prices are for (airports, cabin, travellers, filters); null hides prices. */
export type PriceQuery = Record<string, unknown> & { from: string[]; to: string[] };

type Props = {
  depart: Iso;
  ret: Iso | null;
  roundTrip: boolean;
  today: Iso;
  onChange: (depart: Iso, ret: Iso | null) => void;
  onRoundTrip: (roundTrip: boolean) => void;
  priceQuery: PriceQuery | null;
};

// Prices per search and window, kept for the page's lifetime so reopening is instant.
const priceCache = new Map<string, Map<Iso, number>>();

function usePrices(open: boolean, query: PriceQuery | null, window: { start: Iso; end: Iso }, nights: number | null) {
  const key = query ? JSON.stringify([query, window, nights]) : null;
  const [state, setState] = useState<{ key: string | null; prices: Map<Iso, number>; loading: boolean }>({ key: null, prices: new Map(), loading: false });

  useEffect(() => {
    if (!open || !query || !key || priceCache.has(key)) return;
    const ctrl = new AbortController();
    // Wait a beat so paging quickly through months doesn't fire a request per month.
    const timer = setTimeout(() => {
      setState({ key, prices: new Map(), loading: true });
      const depart = window.start;
      const ret = nights === null ? null : addDaysIso(depart, nights);
      post<DayPrice[]>("/api/calendar", { ...query, depart, return: ret, flexible: true, window }, ctrl.signal)
        .then((days) => {
          const prices = new Map(days.map((d) => [d.depart, d.price]));
          priceCache.set(key, prices);
          setState({ key, prices, loading: false });
        })
        .catch(() => setState((s) => (s.key === key ? { ...s, loading: false } : s)));
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [open, key, query, window, nights]);

  if (!key) return { prices: new Map<Iso, number>(), loading: false };
  const cached = priceCache.get(key);
  if (cached) return { prices: cached, loading: false };
  return state.key === key ? { prices: state.prices, loading: state.loading } : { prices: new Map<Iso, number>(), loading: false };
}

function Month({
  month,
  range,
  hover,
  phase,
  today,
  max,
  focused,
  prices,
  cheapest,
  onPick,
  onHover,
  onFocusDay,
}: {
  month: Iso;
  range: { depart: Iso; return: Iso | null };
  hover: Iso | null;
  phase: Phase;
  today: Iso;
  max: Iso;
  focused: Iso;
  prices: Map<Iso, number>;
  cheapest: Iso | null;
  onPick: (d: Iso) => void;
  onHover: (d: Iso | null) => void;
  onFocusDay: (d: Iso) => void;
}) {
  // While choosing the return, preview the range up to the hovered day.
  const end = range.return ?? (phase === "return" && hover && hover >= range.depart ? hover : null);
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-2 text-center text-sm font-medium text-ink">{monthLabel(month)}</div>
      <div className="grid grid-cols-7 text-center text-[12px] text-ash">
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="pb-2">
            {w}
          </div>
        ))}
      </div>
      <div role="grid" aria-label={monthLabel(month)} className="grid grid-cols-7 gap-y-1">
        {monthGrid(month)
          .flat()
          .map((day, i) => {
            if (!day) return <div key={`e${i}`} />;
            const disabled = day < today || day > max;
            const isStart = day === range.depart;
            const isEnd = day === end;
            const inRange = end !== null && day > range.depart && day < end;
            const price = prices.get(day);
            const edge = isStart || isEnd;
            return (
              <div key={day} className={`relative ${inRange ? "bg-hover" : ""} ${isStart && end && end !== day ? "rounded-l-md bg-hover" : ""} ${isEnd && !isStart ? "rounded-r-md bg-hover" : ""}`}>
                <button
                  type="button"
                  disabled={disabled}
                  tabIndex={day === focused ? 0 : -1}
                  data-day={day}
                  aria-label={`${longLabel(day)}${price ? `, from $${Math.round(price)}` : ""}`}
                  aria-pressed={edge}
                  onClick={() => onPick(day)}
                  onMouseEnter={() => onHover(day)}
                  onFocus={() => onFocusDay(day)}
                  className={`relative flex h-11 w-full cursor-pointer flex-col items-center justify-center rounded-md text-[13px] tnum disabled:cursor-default disabled:text-stone max-sm:h-12 ${
                    edge ? "bg-primary text-primary-on" : disabled ? "" : "text-ink hover:bg-hover"
                  }`}
                >
                  <span className={day === today && !edge ? "underline decoration-accent decoration-2 underline-offset-4" : ""}>{dayOfMonth(day)}</span>
                  {price !== undefined && !disabled && (
                    <span className={`text-[10px] leading-none ${edge ? "text-primary-on/70" : day === cheapest ? "text-accent" : "text-ash"}`}>${Math.round(price)}</span>
                  )}
                </button>
              </div>
            );
          })}
      </div>
    </div>
  );
}

export function DateRangeField({ depart, ret, roundTrip, today, onChange, onRoundTrip, priceQuery }: Props) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("depart");
  const [view, setView] = useState<Iso>(monthStart(depart));
  const [focused, setFocused] = useState<Iso>(depart);
  const [hover, setHover] = useState<Iso | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const max = addDaysIso(today, MAX_AHEAD_DAYS);
  const second = addMonths(view, 1);
  const nights = roundTrip ? (ret ? Math.max(1, nightsBetween(depart, ret)) : DEFAULT_NIGHTS) : null;

  // Prices for the two visible months, from tomorrow at the earliest.
  const window = useMemo(() => {
    const tomorrow = addDaysIso(today, 1);
    return { start: view < tomorrow ? tomorrow : view, end: addDaysIso(addMonths(view, 2), -1) };
  }, [view, today]);
  const { prices, loading } = usePrices(open, priceQuery, window, nights);
  const cheapest = useMemo(() => cheapestDay(prices, today), [prices, today]);

  const openAt = (p: Phase) => {
    const day = p === "return" && ret ? ret : depart;
    setPhase(p);
    setView(monthStart(day));
    setFocused(day);
    setOpen(true);
  };

  // Close on outside click and Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Keep keyboard focus on the focused day as it moves.
  useEffect(() => {
    if (open) root.current?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`)?.focus();
  }, [open, focused, view]);

  const choose = (day: Iso) => {
    const result = pick({ depart, return: ret }, day, phase, roundTrip);
    onChange(result.range.depart, result.range.return);
    setPhase(result.phase);
    setFocused(day);
    if (result.done) setOpen(false);
  };

  const moveFocus = (to: Iso) => {
    const clamped = to < today ? today : to > max ? max : to;
    setFocused(clamped);
    if (clamped < view) setView(monthStart(clamped));
    else if (clamped >= addMonths(view, 2)) setView(addMonths(clamped, -1));
  };

  const onGridKey = (e: React.KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (moves[e.key] !== undefined) {
      e.preventDefault();
      moveFocus(addDaysIso(focused, moves[e.key]));
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      moveFocus(addDaysIso(focused, e.key === "PageUp" ? -30 : 30));
    }
  };

  const canGoBack = view > monthStart(today);
  const canGoForward = addMonths(view, 1) <= monthStart(max);

  const cell = (label: string, value: string, active: boolean, onClick: () => void, dim = false) => (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open && active}
      className={`block w-full cursor-pointer px-3 py-3 text-left ${active && open ? "bg-hover" : "hover:bg-hover"} ${dim ? "text-mute" : ""}`}
    >
      <span className="block text-[12px] text-ash">{label}</span>
      <span className={`mt-1 block text-[15px] tnum ${dim ? "text-mute" : "text-ink"}`}>{value}</span>
    </button>
  );

  return (
    <div ref={root} className="relative h-full">
      <div className="grid h-full grid-cols-2">
        <div className="border-r border-hairline">{cell("Depart", shortLabel(depart), phase === "depart", () => openAt("depart"))}</div>
        {cell("Return", roundTrip ? (ret ? shortLabel(ret) : "Add return") : "One way", phase === "return", () => {
          if (!roundTrip) onRoundTrip(true);
          openAt("return");
        }, !roundTrip || !ret)}
      </div>

      {open && (
        <div
          role="dialog"
          aria-label={phase === "depart" ? "Choose departure date" : "Choose return date"}
          className="rise absolute right-0 top-full z-40 mt-2 w-[min(680px,calc(100vw-32px))] rounded-xl border border-hairline-strong bg-card p-4 max-lg:right-auto max-lg:left-1/2 max-lg:-translate-x-1/2"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="inline-flex rounded-md border border-hairline-strong p-1 pointer-coarse:p-0 text-[13px]">
              {[true, false].map((rt) => (
                <button
                  key={String(rt)}
                  type="button"
                  onClick={() => {
                    onRoundTrip(rt);
                    setPhase("depart");
                  }}
                  className={`h-7 cursor-pointer rounded-sm px-3 pointer-coarse:h-11 ${roundTrip === rt ? "bg-elevated text-ink" : "text-mute hover:text-charcoal"}`}
                >
                  {rt ? "Round trip" : "One way"}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <button type="button" aria-label="Previous month" disabled={!canGoBack} onClick={() => setView(addMonths(view, -1))} className="inline-flex size-8 pointer-coarse:size-11 cursor-pointer items-center justify-center rounded-md text-charcoal hover:bg-hover hover:text-ink disabled:cursor-default disabled:text-stone">
                <ChevronLeft size={16} />
              </button>
              <button type="button" aria-label="Next month" disabled={!canGoForward} onClick={() => setView(addMonths(view, 1))} className="inline-flex size-8 pointer-coarse:size-11 cursor-pointer items-center justify-center rounded-md text-charcoal hover:bg-hover hover:text-ink disabled:cursor-default disabled:text-stone">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          <div className="flex gap-6" onKeyDown={onGridKey} onMouseLeave={() => setHover(null)}>
            {[view, second].map((m, i) => (
              <div key={m} className={`min-w-0 flex-1 ${i === 1 ? "max-sm:hidden" : ""}`}>
                <Month
                  month={m}
                  range={{ depart, return: roundTrip ? ret : null }}
                  hover={hover}
                  phase={phase}
                  today={today}
                  max={max}
                  focused={focused}
                  prices={prices}
                  cheapest={cheapest}
                  onPick={choose}
                  onHover={setHover}
                  onFocusDay={setFocused}
                />
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-hairline pt-3 text-xs text-ash">
            <span className="text-charcoal">
              {roundTrip ? (phase === "depart" ? "Choose your departure" : "Now choose your return") : "Choose your departure"}
              {roundTrip && ret && ` · ${nightsBetween(depart, ret)} night${nightsBetween(depart, ret) === 1 ? "" : "s"}`}
            </span>
            {priceQuery ? (
              loading ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner className="!size-3" /> Loading fares
                </span>
              ) : prices.size ? (
                <span>
                  Lowest {roundTrip ? `round-trip fare for ${nights} night${nights === 1 ? "" : "s"}` : "one-way fare"} by departure day ·{" "}
                  <span className="text-accent">blue</span> is cheapest
                </span>
              ) : null
            ) : (
              <span>Pick airports to see fares on each day</span>
            )}
            <Button size="sm" variant="primary" className="ml-auto" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
