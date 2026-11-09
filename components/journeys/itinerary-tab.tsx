import { BedDouble, Building2, CalendarDays, Map as MapIcon, Plus, UtensilsCrossed } from "lucide-react";
import type { Item, TripDetail } from "@/lib/journeys/types";
import { Button, Spinner } from "../ui";
import { AiButton, AiStatus, EmptyState, TabHead, type Generator } from "./ai-draft";
import { DaySection } from "./day-section";
import { ItemRow } from "./item-row";

// Day by day: every stop in order with drive times, numbered like the map.

type Props = {
  trip: TripDetail;
  days: string[];
  gen: Generator;
  activeDay: string | null;
  selectedId: string | null;
  suggesting: "dining" | "hotels" | null;
  onSuggest: (kind: "dining" | "hotels") => void;
  onFocusDay: (d: string) => void;
  onOpen: (id: string) => void;
  onReplace: (i: Item) => void;
  onDrop: (id: string) => void;
  onAdded: () => void;
  onAddBooking: () => void;
  onEdit: () => void;
  onMap: () => void;
};

export function ItineraryTab(p: Props) {
  const { trip, days, gen } = p;
  const hotelIdeas = trip.items.filter((i) => i.kind === "stay" && i.status === "suggested");
  const hasDates = Boolean(trip.startDate);
  const planned = trip.items.some((i) => i.kind !== "flight" && i.kind !== "stay" && i.status !== "cancelled");

  return (
    <div className="space-y-6">
      <TabHead title="Itinerary" sub={hasDates ? "Click a stop for details. Numbers match the map." : undefined}>
        <Button size="sm" variant="ghost" onClick={p.onAddBooking}>
          <Plus size={14} /> Add
        </Button>
        <AiButton gen={gen} part="itinerary" label={planned ? "Fill gaps with AI" : "Draft the days"} />
        <Button size="sm" variant="ghost" onClick={p.onMap} className="lg:hidden">
          <MapIcon size={14} /> Map
        </Button>
      </TabHead>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <button type="button" disabled={!hasDates || p.suggesting !== null} onClick={() => p.onSuggest("dining")} className="inline-flex h-8 cursor-pointer items-center gap-1.5 text-[13px] text-charcoal hover:text-ink disabled:cursor-default disabled:text-stone">
          {p.suggesting === "dining" ? <Spinner /> : <UtensilsCrossed size={14} aria-hidden />} Plan meals
        </button>
        <button type="button" disabled={!hasDates || !trip.destination || p.suggesting !== null} onClick={() => p.onSuggest("hotels")} className="inline-flex h-8 cursor-pointer items-center gap-1.5 text-[13px] text-charcoal hover:text-ink disabled:cursor-default disabled:text-stone">
          {p.suggesting === "hotels" ? <Spinner /> : <Building2 size={14} aria-hidden />} Find hotels
        </button>
        {p.suggesting && <span className="text-[12px] text-mute">{p.suggesting === "dining" ? "Planning meals around your days…" : "Searching live hotel prices…"}</span>}
      </div>
      <AiStatus gen={gen} parts={["itinerary"]} />

      {hotelIdeas.length > 0 && (
        <section aria-labelledby="hotel-ideas">
          <h3 id="hotel-ideas" className="mb-2 flex items-center gap-2 text-[13px] font-medium text-ink">
            <BedDouble size={14} className="text-accent" aria-hidden /> Hotel ideas
          </h3>
          <ul className="space-y-1">
            {hotelIdeas.map((i) => (
              <ItemRow key={i.id} item={i} selected={i.id === p.selectedId} onOpen={() => p.onOpen(i.id)} onChanged={p.onReplace} onRemoved={() => p.onDrop(i.id)} />
            ))}
          </ul>
        </section>
      )}

      {days.length === 0 ? (
        <EmptyState icon={<CalendarDays size={18} />} title="Add dates to plan day by day" body="Once the trip has dates, each day gets its own list, and your AI can draft them.">
          <Button size="sm" variant="primary" onClick={p.onEdit}>
            Add dates
          </Button>
        </EmptyState>
      ) : (
        <>
          {!planned && (
            <EmptyState icon={<CalendarDays size={18} />} title="The days are empty" body="Your AI can draft a day-by-day plan around what's already booked and what you like. Or add places to each day below.">
              <AiButton gen={gen} part="itinerary" variant="primary" />
            </EmptyState>
          )}
          <ol className="space-y-10">
            {days.map((d) => (
              <DaySection key={d} journey={trip} date={d} active={d === p.activeDay} selectedId={p.selectedId} onFocusDay={() => p.onFocusDay(d)} onOpen={p.onOpen} onReplace={p.onReplace} onDrop={p.onDrop} onAdded={p.onAdded} />
            ))}
          </ol>
        </>
      )}
      {trip.items.some((i) => i.kind === "dining" && i.status === "suggested") && <p className="text-[12px] text-ash">Meal ideas come from the AI&apos;s knowledge, not live listings. Check hours and book ahead.</p>}
    </div>
  );
}
