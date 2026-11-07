import { Car, Plus } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { byItinerary, dayStops, searchCenter } from "@/lib/journeys/locate";
import { daySummary } from "@/lib/journeys/plan";
import type { Item, JourneyWithItems } from "@/lib/journeys/types";
import { directionsUrl, type Leg } from "@/lib/places/types";
import { AddPlace } from "./add-place";
import { Collapsible } from "./collapsible";
import { dayColor, pinsOf } from "./pins";
import { longDay } from "./shared";
import { LegRow, NoteCard, StayRow, StopCard } from "./stop-card";

// One day of a trip: a big date heading with the day in a line under it and
// the day's total driving, the night's stay, the stops in order with the
// drive between each, the AI's ideas apart, and a quiet "Add a place".

const point = (i: Item) => ({ query: `${i.title} ${i.details.address ?? i.place ?? ""}`, location: i.details.lat !== undefined ? { lat: i.details.lat, lng: i.details.lng! } : null });

type Props = {
  journey: JourneyWithItems;
  date: string;
  active: boolean;
  selectedId: string | null;
  onFocusDay: () => void;
  onOpen: (id: string) => void;
  onReplace: (i: Item) => void;
  onDrop: (id: string) => void;
  onAdded: () => void;
};

function useLegs(journeyId: string, date: string, stops: Item[]) {
  const key = stops.map((s) => `${s.id}@${s.details.lat},${s.details.lng}`).join("|");
  const [legs, setLegs] = useState<{ key: string; byFrom: Map<string, Leg | null> }>({ key: "", byFrom: new Map() });
  useEffect(() => {
    if (stops.length < 2) return;
    let alive = true;
    api<{ legs: { from: string; leg: Leg | null }[] }>(`/api/journeys/${journeyId}/legs?date=${date}`)
      .then((r) => alive && setLegs({ key, byFrom: new Map(r.legs.map((l) => [l.from, l.leg])) }))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // `stops` is described by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journeyId, date, key]);
  return legs.key === key ? legs.byFrom : new Map<string, Leg | null>();
}

function driveTotal(legs: Map<string, Leg | null>): string | null {
  const seconds = [...legs.values()].reduce((s, l) => s + (l?.seconds ?? 0), 0);
  if (!seconds) return null;
  const m = Math.max(1, Math.round(seconds / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ""}`;
}

export function DaySection({ journey, date, active, selectedId, onFocusDay, onOpen, onReplace, onDrop, onAdded }: Props) {
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const items = journey.items.filter((i) => i.startDate === date && !(i.kind === "stay" && i.status === "suggested"));
  const firm = items.filter((i) => i.status !== "suggested" && i.kind !== "stay").sort(byItinerary);
  const ideas = items.filter((i) => i.status === "suggested").sort(byItinerary);
  // The stay you wake up in or check out of opens the day; the one you check into closes it.
  const stays = journey.items.filter((i) => i.kind === "stay" && (i.status === "booked" || i.status === "planned") && i.startDate <= date && (i.endDate ?? i.startDate) >= date);
  const morning = stays.filter((s) => s.startDate < date);
  const evening = stays.filter((s) => s.startDate === date);
  const stops = dayStops(journey.items, date);
  const legs = useLegs(journey.id, date, stops);
  const inTrip = journey.startDate && date >= journey.startDate && date <= (journey.endDate ?? journey.startDate);
  const dayNumber = journey.startDate ? Math.round((Date.parse(date) - Date.parse(journey.startDate)) / 86_400_000) + 1 : null;
  const pins = new Map(pinsOf(journey.items).map((p) => [p.item.id, p]));
  const color = dayColor(journey.items, date);
  const near = searchCenter(journey.items, date);
  const summary = daySummary(journey, date);
  const drive = driveTotal(legs);
  const empty = firm.length === 0 && ideas.length === 0;

  const legAfter = (i: Item) => {
    const k = stops.indexOf(i);
    const next = k >= 0 ? stops[k + 1] : undefined;
    return next ? <LegRow key={`leg-${i.id}`} leg={legs.get(i.id)} directions={directionsUrl(point(i), point(next))} /> : null;
  };

  return (
    <li id={`day-${date}`} className="scroll-mt-32">
      <Collapsible
        open={open}
        onToggle={() => (setOpen(!open), onFocusDay())}
        menuLabel={`Actions for ${longDay(date)}`}
        title={
          <span className="flex items-center gap-2.5">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: color.fill }} aria-hidden />
            <span className={active ? "text-ink" : "text-ink/90"}>{longDay(date)}</span>
          </span>
        }
        sub={
          <>
            {[inTrip && dayNumber ? `Day ${dayNumber}` : null, summary || (open ? null : "Nothing planned")].filter(Boolean).join(" · ")}
            {drive && <span className="tnum sm:hidden"> · {drive} driving</span>}
          </>
        }
        aside={
          drive && (
            <span className="tnum hidden items-center gap-1.5 text-[12px] text-mute sm:inline-flex" title="Driving between stops">
              <Car size={13} aria-hidden /> {drive}
            </span>
          )
        }
        menu={[
          { label: "Add a place", onSelect: () => (setOpen(true), setAdding(true)) },
          { label: "Show this day on the map", onSelect: onFocusDay },
        ]}
      >
        <ul className="space-y-2">
          {morning.map((s) => (
            <Fragment key={s.id}>
              <StayRow stay={s} date={date} onOpen={() => onOpen(s.id)} />
              {stops[0]?.id === s.id && legAfter(s)}
            </Fragment>
          ))}
          {firm.map((i) =>
            i.kind === "note" ? (
              <NoteCard key={i.id} item={i} onOpen={() => onOpen(i.id)} onRemoved={() => onDrop(i.id)} />
            ) : (
              <Fragment key={i.id}>
                <StopCard item={i} pin={pins.get(i.id)} selected={i.id === selectedId} onOpen={() => onOpen(i.id)} onChanged={onReplace} onRemoved={() => onDrop(i.id)} />
                {legAfter(i)}
              </Fragment>
            ),
          )}
          {evening.map((s) => (
            <StayRow key={s.id} stay={s} date={date} onOpen={() => onOpen(s.id)} />
          ))}
          {ideas.length > 0 && <li className="pt-2 text-[12px] font-medium text-mute">Ideas for this day</li>}
          {ideas.map((i) => (
            <StopCard key={i.id} item={i} pin={pins.get(i.id)} selected={i.id === selectedId} onOpen={() => onOpen(i.id)} onChanged={onReplace} onRemoved={() => onDrop(i.id)} />
          ))}
        </ul>
        {adding ? (
          <AddPlace journeyId={journey.id} date={date} near={near} onAdded={onAdded} />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className={`mt-2 inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[13px] text-mute hover:bg-hover hover:text-ink ${empty ? "" : "-ml-2"}`}>
            <Plus size={14} aria-hidden /> {empty ? "Nothing planned yet. Add a place" : "Add a place"}
          </button>
        )}
      </Collapsible>
    </li>
  );
}
