import { BedDouble, Check, Copy, Plane, Plus, Ticket, TrainFront, UtensilsCrossed } from "lucide-react";
import { useState } from "react";
import { day } from "@/lib/format";
import { bookings } from "@/lib/journeys/plan";
import type { Item, Kind, TripDetail } from "@/lib/journeys/types";
import { Button } from "../ui";
import { EmptyState, TabHead } from "./ai-draft";
import { amount, shortDate, time12, timeRange } from "./shared";

// Confirmations: every booked flight, stay, car and reservation with its
// number one tap from the clipboard, like the folder of emails it replaces.

const GROUP: Record<Kind, { label: string; icon: typeof Plane }> = {
  flight: { label: "Flights", icon: Plane },
  stay: { label: "Stays", icon: BedDouble },
  transport: { label: "Getting around", icon: TrainFront },
  activity: { label: "Activities", icon: Ticket },
  dining: { label: "Restaurants", icon: UtensilsCrossed },
  note: { label: "Other", icon: Ticket },
};

export function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(code).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      aria-label={`Copy confirmation ${code}`}
      className="inline-flex h-8 pointer-coarse:h-11 cursor-pointer items-center gap-2 rounded-md border border-hairline-hover bg-card px-3 font-mono text-[13px] text-ink hover:border-hairline-hover"
    >
      {code}
      {copied ? <Check size={12} className="text-ok" aria-hidden /> : <Copy size={12} className="text-ash" aria-hidden />}
    </button>
  );
}

function when(i: Item): string {
  if (i.kind === "stay") return `${shortDate(i.startDate)} – ${i.endDate ? shortDate(i.endDate) : "?"}`;
  // A car or tour over several days: both ends as dates, each with its time.
  if (i.kind !== "flight" && i.endDate && i.endDate !== i.startDate) {
    const at = (d: string, t: string | null) => `${day(d)}${t ? ` ${time12(t)}` : ""}`;
    return `${at(i.startDate, i.startTime)} → ${at(i.endDate, i.endTime)}`;
  }
  return `${day(i.startDate)}${i.startTime ? ` · ${timeRange(i)}` : ""}`;
}

export function BookingsTab({ trip, onOpenItem, onAdd }: { trip: TripDetail; onOpenItem: (id: string) => void; onAdd: () => void }) {
  const groups = bookings(trip.items);
  const count = groups.reduce((n, g) => n + g.items.filter((i) => i.status === "booked").length, 0);
  return (
    <div className="space-y-6">
      <TabHead title="Bookings" sub={count ? `${count} confirmed. Forward a confirmation email and it lands here.` : undefined}>
        <Button size="sm" variant="ghost" onClick={onAdd}>
          <Plus size={14} /> Add booking
        </Button>
      </TabHead>
      {groups.length === 0 && (
        <EmptyState icon={<Ticket size={18} />} title="No bookings yet" body="Forward confirmation emails to your Lodestar address, connect Flint, or add one by hand. Things you mark booked on To book show up here too.">
          <Button size="sm" variant="primary" onClick={onAdd}>
            <Plus size={14} /> Add booking
          </Button>
        </EmptyState>
      )}
      {groups.map((g) => {
        const Icon = GROUP[g.kind].icon;
        return (
          <section key={g.kind} aria-label={GROUP[g.kind].label}>
            <h3 className="flex items-center gap-2 text-[13px] font-medium text-charcoal">
              <Icon size={14} aria-hidden /> {GROUP[g.kind].label}
            </h3>
            <ul className="mt-2 divide-y divide-hairline overflow-hidden rounded-xl border border-hairline-strong bg-card">
              {g.items.map((i) => {
                const cancelled = i.status === "cancelled";
                return (
                  <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 sm:flex-nowrap">
                    <button type="button" onClick={() => onOpenItem(i.id)} className="min-w-0 flex-1 cursor-pointer text-left pointer-coarse:min-h-11">
                      <span className={`block truncate text-[14px] ${cancelled ? "text-ash line-through" : "text-ink"}`}>{i.title}</span>
                      <span className="tnum block truncate text-[12px] text-mute">
                        {[when(i), i.details.provider ?? i.details.airline, cancelled ? "Cancelled" : null].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-3">
                      {i.details.price !== undefined && <span className="tnum text-[13px] text-body">{amount(i.details.price, i.details.currency)}</span>}
                      {i.confirmation ? <CopyCode code={i.confirmation} /> : <span className="text-[12px] text-ash">No number</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
