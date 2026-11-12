import { Plane } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { day } from "@/lib/format";
import { duration, type FlightEnd, type FlightView, type Tone } from "@/lib/journeys/flight-view";
import type { Item } from "@/lib/journeys/types";
import { AirlineLogo } from "../logo";
import { brandOf, stripeCss } from "./airline-brand";
import { CopyCode } from "./bookings-tab";
import { time12 } from "./shared";

// The Flights tab's card: the airline's colours across the top, both airports
// with their times large, a route line the plane moves along once it's in the
// air, and what's happening now under it.

const TONE_BAR: Record<Tone, string> = { ok: "bg-ok/10 text-ok", warn: "bg-warn/10 text-warn", danger: "bg-danger/10 text-danger", idle: "bg-elevated text-mute" };
const LIVE_PHASES = new Set(["checkin", "boarding", "departed", "delayed"]);

export const clock = (t: string | null) => (t ? time12(t) : "—");

/** "Terminal 1 · Gate B12", or what's known of it. */
export function gateLine(e: FlightEnd): string | null {
  return [e.terminal ? `Terminal ${e.terminal}` : null, e.gate ? `Gate ${e.gate}` : null].filter(Boolean).join(" · ") || null;
}

function Ends({ e, align }: { e: FlightEnd; align: "left" | "right" }) {
  const right = align === "right";
  return (
    <div className={`min-w-0 ${right ? "text-right" : ""}`}>
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-mute">{right ? "Arrive" : "Depart"}</div>
      <div className="mt-2 font-mono text-[30px] font-medium leading-none text-ink sm:text-[34px]">{e.code ?? "—"}</div>
      <div className="tnum mt-2.5 whitespace-nowrap font-mono text-[20px] font-medium leading-tight text-ink sm:text-[22px]">
        {e.time ? clock(e.time) : <span className="text-[14px] font-normal text-mute">Time not saved</span>}
        {e.time && e.zone && <small className="ml-1 text-[12px] font-normal text-mute">{e.zone}</small>}
      </div>
      <div className="tnum min-h-4 font-mono text-[12px] text-mute line-through">{e.was ? clock(e.was) : null}</div>
      {(e.city ?? e.name) && <div className="mt-1 truncate text-[13px] text-body">{e.city ?? e.name}</div>}
      <div className="mt-0.5 font-mono text-[12px] text-mute">{gateLine(e) ?? "Gate posted on travel day"}</div>
    </div>
  );
}

function Track({ progress, label }: { progress: number; label: string | null }) {
  const pct = `${Math.round(progress * 100)}%`;
  return (
    <div className="pt-1 text-center sm:pt-8">
      <div className="relative h-5" style={{ "--p": pct } as CSSProperties}>
        <span className="absolute inset-x-0 top-[9px] border-t-[1.5px] border-dashed border-hairline-hover" aria-hidden />
        <span className="absolute left-0 top-[9px] h-[1.5px] bg-accent" style={{ width: pct }} aria-hidden />
        <span className="absolute -left-px top-[5px] size-[9px] rounded-full border-[1.5px] border-hairline-hover bg-card" aria-hidden />
        <span className="absolute -right-px top-[5px] size-[9px] rounded-full border-[1.5px] border-hairline-hover bg-card" aria-hidden />
        <span className="absolute top-0 grid size-5 place-items-center bg-card text-ink transition-[left] duration-500" style={{ left: `calc(${pct} - 10px)` }} aria-hidden>
          <Plane size={14} className="rotate-45" />
        </span>
      </div>
      {label && <div className="tnum mt-1.5 font-mono text-[12px] text-mute">{label}</div>}
    </div>
  );
}

/** One line on what's happening, in the status colour. */
function liveLine(v: FlightView): ReactNode {
  const { from, to } = v;
  switch (v.phase) {
    case "booked":
    case "unknown":
      return null;
    case "scheduled":
      return from.gate ? `On time · Gate ${from.gate}` : "On time · the gate is posted on travel day";
    case "checkin":
      return `Check-in open${from.gate ? ` · Gate ${from.gate}` : ""}`;
    case "boarding":
      return `Boarding now${from.gate ? ` · Gate ${from.gate}` : ""}`;
    case "departed":
      return `In the air · lands ${clock(to.time)}${to.zone ? ` ${to.zone}` : ""}${to.gate ? ` at gate ${to.gate}` : ""}`;
    case "delayed":
      return `${v.status} · now leaves ${clock(from.time)}${from.gate ? ` from gate ${from.gate}` : ""}`;
    case "landed":
      return `Landed ${clock(to.time)}${to.baggage ? ` · bags on carousel ${to.baggage}` : ""}`;
    case "cancelled":
      return "Cancelled. Rebook with the airline.";
    case "diverted":
      return "Diverted. Check with the airline for where it's landing.";
  }
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 border-hairline px-4 py-3 sm:px-5 [&:not(:last-child)]:border-r max-sm:[&:nth-child(2)]:border-r-0 max-sm:[&:nth-child(-n+2)]:border-b">
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-mute">{label}</div>
      <div className="tnum mt-1.5 break-words font-mono text-[14px] font-medium text-ink">{children}</div>
    </div>
  );
}

export function StatusBadge({ v, onBrand = false }: { v: FlightView; onBrand?: boolean }) {
  const dot = { ok: "bg-ok", warn: "bg-warn", danger: "bg-danger", idle: onBrand ? "bg-white/70" : "bg-stone" }[v.tone];
  const pulse = LIVE_PHASES.has(v.phase) ? "motion-safe:animate-pulse" : "";
  return (
    <span className={`inline-flex h-[26px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium ${onBrand ? "bg-white/15 text-white" : "bg-elevated text-body"}`}>
      <span className={`size-[7px] rounded-full ${dot} ${pulse}`} aria-hidden />
      {v.status}
    </span>
  );
}

const checked = (at: number) => new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

type Props = { item: Item; v: FlightView; travelers: number | null; checkedAt: number | null; liveOn: boolean; onOpen: () => void };

export function FlightCard({ item, v, travelers, checkedAt, liveOn, onOpen }: Props) {
  const brand = brandOf(v.airline);
  const line = liveLine(v);
  const cancelled = v.phase === "cancelled";
  const when = day(v.from.date);
  return (
    <article className="overflow-hidden rounded-xl border border-hairline-strong bg-card" aria-label={`${v.airlineName} ${v.label}`}>
      <button type="button" onClick={onOpen} className="relative flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left text-white sm:px-5" style={{ background: brand.bg }}>
        {v.airline ? <AirlineLogo code={v.airline} name={v.airlineName} size={34} /> : <span className="grid size-[34px] place-items-center rounded-md bg-white/15"><Plane size={16} /></span>}
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[15px] font-semibold leading-tight ${cancelled ? "line-through opacity-70" : ""}`}>
            {v.airlineName} · {v.label}
          </span>
          <span className="block truncate font-mono text-[12px] opacity-80">{[when, v.aircraft].filter(Boolean).join(" · ")}</span>
        </span>
        <StatusBadge v={v} onBrand />
        <span className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: stripeCss(brand) }} aria-hidden />
      </button>

      <div className="grid grid-cols-2 gap-3 px-4 pb-4 pt-5 sm:grid-cols-[1fr_minmax(90px,1.2fr)_1fr] sm:px-5">
        <Ends e={v.from} align="left" />
        <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
          <Track progress={v.progress} label={v.phase === "departed" && v.to.time ? `lands ${clock(v.to.time)}` : v.minutes ? duration(v.minutes) : null} />
        </div>
        <Ends e={v.to} align="right" />
      </div>

      {line && <p className={`mx-4 rounded-md px-3 py-2.5 text-[13px] sm:mx-5 ${TONE_BAR[v.tone]}`}>{line}</p>}
      {!line && liveOn && !v.live && !cancelled && <p className={`mx-4 rounded-md px-3 py-2.5 text-[13px] sm:mx-5 ${TONE_BAR.idle}`}>Live status, gate and delays show up within 30 days of the flight.</p>}

      <div className="mt-4 grid grid-cols-2 border-t border-hairline sm:grid-cols-4">
        <Fact label="Confirmation">{item.confirmation ? <CopyCode code={item.confirmation} /> : "—"}</Fact>
        <Fact label="Travellers">{item.details.guests ?? travelers ?? "—"}</Fact>
        <Fact label={`Be at ${v.from.code ?? "the airport"} by`}>{v.from.beThere ? clock(v.from.beThere) : "—"}</Fact>
        <Fact label="Baggage">{v.to.baggage ? `Carousel ${v.to.baggage}` : "—"}</Fact>
      </div>
      {(checkedAt || v.shift) && (
        <div className="flex flex-wrap justify-between gap-3 border-t border-hairline px-4 py-3 text-[12px] text-mute sm:px-5">
          <span>{v.shift ? `Clocks ${v.shift > 0 ? "go forward" : "go back"} ${Math.abs(v.shift / 60)} hr on landing.` : null}</span>
          {checkedAt && <span>Live from AeroDataBox · checked {checked(checkedAt)}</span>}
        </div>
      )}
    </article>
  );
}
