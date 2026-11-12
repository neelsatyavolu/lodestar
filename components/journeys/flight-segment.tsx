import { Plane } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/client";
import { duration, type FlightEnd, type FlightView } from "@/lib/journeys/flight-view";
import type { FlightGroup } from "@/lib/journeys/flights";
import type { Item } from "@/lib/journeys/types";
import { askConfirm } from "../confirm";
import { AirlineLogo } from "../logo";
import { MoreMenu, type MenuItem } from "./collapsible";
import { clock, gateLine, StatusBadge } from "./flight-card";
import type { Pin } from "./pins";
import { errorText, patchItem } from "./shared";

// A flight in the itinerary: one card for leaving, flying and landing, in
// place of separate "SFO Terminal 1" and "Land at PHX" stops. Those stops
// keep their pins and open from their row; the flight opens from its header.

type Props = {
  group: FlightGroup;
  v: FlightView;
  pins: Map<string, Pin>;
  selectedId: string | null;
  onOpen: (id: string) => void;
  onChanged: (i: Item) => void;
  onRemoved: () => void;
};

/** The stop's map number in its day colour, or a plane when the airport isn't pinned. */
function Node({ pin }: { pin: Pin | undefined }) {
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-full font-mono text-[12px] font-medium" style={{ background: pin?.color.fill ?? "var(--accent)", color: pin?.color.ink ?? "var(--accent-on)" }} aria-hidden>
      {pin ? pin.n : <Plane size={13} className="rotate-45" />}
    </span>
  );
}

const Link = ({ className = "" }: { className?: string }) => <span className={`min-h-2 w-0.5 flex-1 bg-[repeating-linear-gradient(to_bottom,var(--line-3)_0_4px,transparent_4px_8px)] ${className}`} aria-hidden />;

function Leg({ e, stop, kind, onOpen }: { e: FlightEnd; stop: Item | null; kind: "from" | "to"; onOpen: (id: string) => void }) {
  const sub = [gateLine(e) ?? (kind === "from" ? "Gate posted on travel day" : null), kind === "to" ? e.note : null].filter(Boolean).join(" · ");
  const body = (
    <>
      <span className="flex min-h-7 items-center gap-2.5">
        <span className="rounded-sm bg-elevated px-1.5 py-1 font-mono text-[13px] font-medium leading-none text-ink">{e.code ?? "—"}</span>
        {e.name && <span className="truncate font-medium text-ink">{e.name}</span>}
      </span>
      {sub && <span className="mt-1 block text-[13px] text-mute">{sub}</span>}
      {kind === "from" && e.beThere && (
        <span className="mt-1.5 flex items-center gap-2 text-[12px] text-warn">
          <Plane size={12} aria-hidden /> Be there by {clock(e.beThere)}
        </span>
      )}
    </>
  );
  return stop ? (
    <button type="button" onClick={(ev) => (ev.stopPropagation(), onOpen(stop.id))} className="min-w-0 cursor-pointer rounded-md text-left hover:bg-hover pointer-coarse:min-h-11 max-sm:col-start-2">
      {body}
    </button>
  ) : (
    <div className="min-w-0 max-sm:col-start-2">{body}</div>
  );
}

function Clock({ e }: { e: FlightEnd }) {
  return (
    <div className="tnum whitespace-nowrap font-mono text-[20px] font-medium leading-7 text-ink">
      {clock(e.time)}
      {e.zone && <small className="block text-[11px] font-normal leading-[14px] tracking-[0.04em] text-mute max-sm:ml-1 max-sm:inline">{e.zone}</small>}
      {e.was && <small className="block text-[11px] font-normal leading-[14px] text-mute line-through">{clock(e.was)}</small>}
    </div>
  );
}

export function FlightSegment({ group, v, pins, selectedId, onOpen, onChanged, onRemoved }: Props) {
  const { flight, departure, arrival } = group;
  const [error, setError] = useState<string | null>(null);
  const selected = [flight.id, departure?.id, arrival?.id].includes(selectedId ?? "");
  const cancelled = flight.status === "cancelled";

  const patch = async (body: Record<string, unknown>) => {
    setError(null);
    try {
      onChanged(await patchItem(flight.id, body));
    } catch (err) {
      setError(errorText(err, "Couldn't update it."));
    }
  };
  const remove = async () => {
    if (!(await askConfirm(`Remove ${flight.title}?`, "Remove", "The airport stops around it stay in the itinerary."))) return;
    try {
      await api(`/api/journeys/items/${flight.id}`, { method: "DELETE" });
      onRemoved();
    } catch (err) {
      setError(errorText(err, "Couldn't remove it."));
    }
  };
  const menu: MenuItem[] = [
    { label: "Flight details", onSelect: () => onOpen(flight.id) },
    ...(flight.status === "planned" ? [{ label: "Mark booked", onSelect: () => patch({ status: "booked" }) }] : []),
    ...(flight.status === "booked" ? [{ label: "Mark cancelled", onSelect: () => patch({ status: "cancelled" }) }] : []),
    { label: "Remove", onSelect: remove, danger: true },
  ];
  const sub = [v.minutes ? duration(v.minutes) : null, flight.details.guests ? `${flight.details.guests} travelers` : null, v.aircraft].filter(Boolean).join(" · ");

  return (
    <li className={`overflow-hidden rounded-xl border bg-card transition-colors duration-150 ${selected ? "border-hairline-hover" : "border-hairline-strong"}`}>
      <div onClick={() => onOpen(flight.id)} className="flex cursor-pointer items-center gap-3 border-b border-hairline px-3 py-3 hover:bg-hover sm:px-4">
        {v.airline ? <AirlineLogo code={v.airline} name={v.airlineName} size={28} /> : <Node pin={undefined} />}
        <div className="min-w-0 flex-1">
          <p className={`truncate text-[15px] font-semibold leading-snug ${cancelled ? "text-ash line-through" : "text-ink"}`}>
            {v.airlineName} {v.label}
            {v.from.code && v.to.code && (
              <span className="font-normal text-body">
                {" "}
                · {v.from.code} → {v.to.code}
              </span>
            )}
          </p>
          {sub && <p className="tnum truncate font-mono text-[12px] text-mute">{sub}</p>}
        </div>
        <StatusBadge v={v} />
        <div onClick={(e) => e.stopPropagation()} className="-mr-1.5 shrink-0">
          <MoreMenu items={menu} label={`Actions for ${flight.title}`} />
        </div>
      </div>

      {/* One grid for both ends: node | time | airport. Each end starts on the same 28px line. */}
      <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-4 px-3 pb-3.5 pt-4 sm:grid-cols-[28px_112px_minmax(0,1fr)] sm:px-4">
        <div className="flex flex-col items-center max-sm:row-span-2">
          <Node pin={departure ? pins.get(departure.id) : undefined} />
          <Link className="mt-1.5" />
        </div>
        <Clock e={v.from} />
        <Leg e={v.from} stop={departure} kind="from" onOpen={onOpen} />

        <div className="flex flex-col items-center">
          <Link className="mb-1.5" />
        </div>
        <p className="tnum col-start-2 flex items-center gap-2 py-3.5 font-mono text-[12px] text-mute sm:col-span-2">
          <Plane size={12} className="rotate-45" aria-hidden />
          {[v.minutes ? `${duration(v.minutes)} in the air` : "In the air", v.shift ? `clocks ${v.shift > 0 ? "jump" : "go back"} ${Math.abs(v.shift / 60)} hr` : null].filter(Boolean).join(" · ")}
        </p>

        <div className="flex flex-col items-center max-sm:row-span-2">
          <Node pin={arrival ? pins.get(arrival.id) : undefined} />
        </div>
        <Clock e={v.to} />
        <Leg e={v.to} stop={arrival} kind="to" onOpen={onOpen} />
      </div>

      {(flight.confirmation || error) && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-hairline px-3 py-2.5 text-[12px] text-mute sm:px-4">
          {flight.confirmation && (
            <span>
              Conf. <span className="font-mono font-medium text-ink">{flight.confirmation}</span>
            </span>
          )}
          {error && <span className="text-danger">{error}</span>}
        </div>
      )}
    </li>
  );
}
