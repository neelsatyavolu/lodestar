import { airlineName } from "../airlines";
import type { FlightStatus, Phase } from "../flights/types";
import { flightAirports, flightCode, type FlightGroup } from "./flights";
import type { Item } from "./types";

// What a flight card shows: the booking's own facts, overlaid with live
// status where AeroDataBox has it. Pure, so both cards and tests share it.

export type Tone = "ok" | "warn" | "danger" | "idle";

export type FlightEnd = {
  code: string | null;
  /** "San Francisco International": live, else the folded stop's address. */
  name: string | null;
  city: string | null;
  /** "10:20" local: the latest known time, else the booked one. */
  time: string | null;
  date: string;
  /** The booked time when the latest differs from it, for striking through. */
  was: string | null;
  zone: string | null;
  terminal: string | null;
  gate: string | null;
  baggage: string | null;
  /** The folded airport stop's time: when to be at the airport. */
  beThere: string | null;
  /** The folded stop's own note, like how to reach the rental cars. */
  note: string | null;
};

export type FlightView = {
  airline: string | null;
  airlineName: string;
  /** "WN 4623", or the item's title when there's no number. */
  label: string;
  from: FlightEnd;
  to: FlightEnd;
  minutes: number | null;
  /** How far clocks move between the two airports, in minutes: 60 flying SFO to PHX in November. */
  shift: number | null;
  phase: Phase | "booked";
  status: string;
  tone: Tone;
  /** 0 before take-off, 1 once landed, in between while in the air. */
  progress: number;
  aircraft: string | null;
  live: boolean;
};

const terminalIn = (s: Item | null) => s?.title.match(/\bterminal\s+([A-Z0-9]{1,3})\b/i)?.[1]?.toUpperCase() ?? null;

/** "2h05", "2 hr 05 min", "2h 5m" in the title or note → 125. */
export function bookedMinutes(item: Item): number | null {
  const m = `${item.title} ${item.details.note ?? ""}`.match(/\b(\d{1,2})\s*(?:h|hr|hrs|hours?)\s*(\d{1,2})?\s*(?:m|min|mins|minutes?)?\b/i);
  return m ? Number(m[1]) * 60 + Number(m[2] ?? 0) : null;
}

const LABEL: Record<Phase, [string, Tone]> = {
  scheduled: ["On time", "ok"],
  checkin: ["Check-in open", "ok"],
  boarding: ["Boarding", "ok"],
  departed: ["In the air", "ok"],
  landed: ["Landed", "ok"],
  delayed: ["Delayed", "warn"],
  cancelled: ["Cancelled", "danger"],
  diverted: ["Diverted", "danger"],
  unknown: ["Scheduled", "idle"],
};

export function flightView(group: FlightGroup, status: FlightStatus | null | undefined, now = Date.now()): FlightView {
  const { flight, departure, arrival } = group;
  const code = flightCode(flight);
  const airports = flightAirports(flight);
  const s = status ?? null;
  const end = (side: "from" | "to"): FlightEnd => {
    const live = side === "from" ? s?.departure : s?.arrival;
    const stop = side === "from" ? departure : arrival;
    const booked = side === "from" ? flight.startTime : flight.endTime;
    const scheduled = live?.scheduled?.time ?? booked;
    const latest = live?.latest?.time ?? null;
    return {
      code: live?.code ?? airports[side],
      name: live?.name ?? stop?.details.address?.split(",")[0]?.trim() ?? null,
      city: live?.city ?? null,
      time: latest ?? scheduled,
      date: live?.latest?.date ?? live?.scheduled?.date ?? (side === "from" ? flight.startDate : (flight.endDate ?? flight.startDate)),
      was: latest && scheduled && latest !== scheduled ? scheduled : null,
      zone: live?.zone ?? null,
      terminal: live?.terminal ?? terminalIn(stop),
      gate: live?.gate ?? null,
      baggage: live?.baggage ?? null,
      beThere: side === "from" ? (stop?.startTime ?? null) : null,
      note: stop?.details.note ?? null,
    };
  };

  const dep = s?.departure.latest?.utc ?? s?.departure.scheduled?.utc;
  const arr = s?.arrival.latest?.utc ?? s?.arrival.scheduled?.utc;
  const sched = s?.departure.scheduled && s.arrival.scheduled ? Math.round((s.arrival.scheduled.utc - s.departure.scheduled.utc) / 60_000) : null;
  const clock = (m: { date: string; time: string } | null | undefined) => (m ? Date.parse(`${m.date}T${m.time}:00Z`) : null);
  const localDep = clock(s?.departure.scheduled);
  const localArr = clock(s?.arrival.scheduled);
  const shift = sched !== null && localDep !== null && localArr !== null ? Math.round((localArr - localDep) / 60_000) - sched : null;
  const cancelled = flight.status === "cancelled" || s?.phase === "cancelled";
  const phase: Phase | "booked" = flight.status === "cancelled" ? "cancelled" : (s?.phase ?? "booked");
  const [word, tone] = phase === "booked" ? [flight.status === "booked" ? "Booked" : "Planned", "idle" as Tone] : LABEL[phase];
  const label = phase === "delayed" && s?.delay ? `Delayed ${s.delay} min` : word;
  const progress = phase === "landed" ? 1 : phase === "departed" && dep && arr && arr > dep ? Math.min(1, Math.max(0, (now - dep) / (arr - dep))) : 0;

  return {
    airline: code?.airline ?? null,
    airlineName: flight.details.airline ?? (code ? airlineName(code.airline, s?.airline ?? code.airline) : (s?.airline ?? "Flight")),
    label: code ? `${code.airline} ${code.number}` : flight.title,
    from: end("from"),
    to: end("to"),
    minutes: sched ?? bookedMinutes(flight),
    shift,
    phase,
    status: label,
    tone: cancelled ? "danger" : tone,
    progress,
    aircraft: s?.aircraft ?? null,
    live: Boolean(s),
  };
}

/** "2h 05m". */
export const duration = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
