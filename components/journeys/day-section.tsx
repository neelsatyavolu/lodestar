import { Car, ExternalLink } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { day } from "@/lib/format";
import { byItinerary, dayStops, searchCenter } from "@/lib/journeys/locate";
import type { Item, JourneyWithItems } from "@/lib/journeys/types";
import { directionsUrl, legLabel, type Leg } from "@/lib/places/types";
import { AddPlace } from "./add-place";
import { ItemRow } from "./item-row";
import { dayColor, pinsOf } from "./pins";
import { stayOn } from "./shared";

// One day of a trip: where you sleep, the stops in order with the drive
// between each, the AI's ideas apart, and a box to add a place.

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

export function DaySection({ journey, date, active, selectedId, onFocusDay, onOpen, onReplace, onDrop, onAdded }: Props) {
  const items = journey.items.filter((i) => i.startDate === date && !(i.kind === "stay" && i.status === "suggested"));
  const firm = items.filter((i) => i.status !== "suggested").sort(byItinerary);
  const ideas = items.filter((i) => i.status === "suggested").sort(byItinerary);
  const stay = stayOn(journey.items, date);
  const sleeping = stay && stay.startDate !== date ? stay : null;
  const stops = dayStops(journey.items, date);
  const legs = useLegs(journey.id, date, stops);
  const inTrip = journey.startDate && date >= journey.startDate && date <= (journey.endDate ?? journey.startDate);
  const dayNumber = journey.startDate ? Math.round((Date.parse(date) - Date.parse(journey.startDate)) / 86_400_000) + 1 : null;

  const pins = new Map(pinsOf(journey.items).map((p) => [p.item.id, p]));
  const color = dayColor(journey.items, date);
  const near = searchCenter(journey.items, date);
  const row = (i: Item) => <ItemRow key={i.id} item={i} pin={pins.get(i.id)} selected={i.id === selectedId} onOpen={() => onOpen(i.id)} onChanged={onReplace} onRemoved={() => onDrop(i.id)} />;

  return (
    <li id={`day-${date}`} className="scroll-mt-20">
      <button type="button" onClick={onFocusDay} className={`flex w-full cursor-pointer items-baseline gap-3 border-b pb-2 text-left ${active ? "border-hairline-hover" : "border-hairline"}`}>
        <span className="size-2.5 shrink-0 self-center rounded-full" style={{ background: color.fill }} aria-hidden />
        <h2 className={`text-[15px] font-medium ${active ? "text-ink" : "text-charcoal"}`}>{day(date)}</h2>
        {inTrip && dayNumber && <span className="text-[12px] text-ash">Day {dayNumber}</span>}
        {sleeping && <span className="ml-auto truncate text-[12px] text-mute">Staying at {sleeping.title}</span>}
      </button>
      {firm.length > 0 && (
        <ul className="mt-1">
          {firm.map((i) => {
            const next = stops[stops.indexOf(i) + 1];
            const leg = stops.includes(i) && next ? legs.get(i.id) : undefined;
            return (
              <Fragment key={i.id}>
                {row(i)}
                {stops.includes(i) && next && (
                  <li className="flex items-center gap-2 py-1 pl-[76px] text-[12px] text-ash">
                    <Car size={13} aria-hidden />
                    {leg && <span className="tnum">{legLabel(leg)}</span>}
                    <a href={directionsUrl(point(i), point(next))} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-charcoal hover:text-ink">
                      Directions <ExternalLink size={11} aria-hidden />
                    </a>
                  </li>
                )}
              </Fragment>
            );
          })}
        </ul>
      )}
      {ideas.length > 0 && <ul className="mt-2 space-y-1.5">{ideas.map(row)}</ul>}
      <AddPlace journeyId={journey.id} date={date} near={near} onAdded={onAdded} />
    </li>
  );
}
