import { Plane, Plus } from "lucide-react";
import { flightView } from "@/lib/journeys/flight-view";
import { flightGroups, type FlightGroup } from "@/lib/journeys/flights";
import { byItinerary } from "@/lib/journeys/locate";
import type { TripDetail } from "@/lib/journeys/types";
import { Button } from "../ui";
import { EmptyState, TabHead } from "./ai-draft";
import { FlightCard } from "./flight-card";
import type { Flights } from "./use-flights";

// Every flight on the trip as a card, in order, with live status on travel day.

type Props = { trip: TripDetail; flights: Flights; onOpenItem: (id: string) => void; onAdd: () => void };

export function FlightsTab({ trip, flights, onOpenItem, onAdd }: Props) {
  const groups = new Map(flightGroups(trip.items).map((g) => [g.flight.id, g]));
  const list = trip.items.filter((i) => i.kind === "flight" && i.status !== "suggested").sort(byItinerary);
  const group = (id: string): FlightGroup => groups.get(id) ?? { flight: list.find((f) => f.id === id)!, departure: null, arrival: null };

  return (
    <div className="space-y-6">
      <TabHead title="Flights" sub={list.length ? (flights.live ? "Live status, gates and delays refresh every few minutes on travel day." : "Times as booked.") : undefined}>
        <Button size="sm" variant="ghost" onClick={onAdd}>
          <Plus size={14} /> Add flight
        </Button>
      </TabHead>
      {list.length === 0 && (
        <EmptyState icon={<Plane size={18} />} title="No flights yet" body="Forward an airline confirmation to your Lodestar address, or add a flight by hand. Each one gets live status on travel day.">
          <Button size="sm" variant="primary" onClick={onAdd}>
            <Plus size={14} /> Add flight
          </Button>
        </EmptyState>
      )}
      <div className="space-y-4">
        {list.map((f) => {
          const status = flights.byId[f.id];
          return <FlightCard key={f.id} item={f} v={flightView(group(f.id), status)} travelers={trip.travelers} checkedAt={status?.checkedAt ?? null} liveOn={flights.live} onOpen={() => onOpenItem(f.id)} />;
        })}
      </div>
    </div>
  );
}
