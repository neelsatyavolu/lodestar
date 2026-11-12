import { BedDouble, ExternalLink, Plus, Star } from "lucide-react";
import { day } from "@/lib/format";
import { byItinerary } from "@/lib/journeys/locate";
import { nights } from "@/lib/journeys/plan";
import type { Item, TripDetail } from "@/lib/journeys/types";
import { Button, Pill } from "../ui";
import { EmptyState, TabHead } from "./ai-draft";
import { CopyCode } from "./bookings-tab";
import { photoUrl, useInView, usePlace } from "./place-cache";
import { amount, shortDate, time12 } from "./shared";

// Every stay on the trip: photo, check-in and check-out with the nights
// between, and the confirmation, phone and directions in one place.

const nightCount = (s: Item) => (s.endDate ? Math.max(1, Math.round((Date.parse(`${s.endDate}T12:00:00Z`) - Date.parse(`${s.startDate}T12:00:00Z`)) / 86_400_000)) : null);

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-mute">{label}</div>
      <div className="tnum mt-1.5 break-words font-mono text-[13px] font-medium text-ink">{children}</div>
    </div>
  );
}

function HotelCard({ stay, onOpen }: { stay: Item; onOpen: () => void }) {
  const [ref, seen] = useInView<HTMLElement>();
  const { place } = usePlace(stay.details.placeId, seen);
  const photo = place?.photos[0];
  const rating = place?.rating ?? stay.details.rating ?? null;
  const address = place?.address ?? stay.details.address ?? stay.place;
  const phone = place?.phone ?? stay.details.phone;
  const site = place?.website ?? stay.details.url;
  const n = nightCount(stay);
  const price = stay.details.price ?? stay.details.estimate;
  const cancelled = stay.status === "cancelled";
  const maps = address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${stay.title} ${address}`)}` : null;

  return (
    <article ref={ref} className="grid overflow-hidden rounded-xl border border-hairline-strong bg-card sm:grid-cols-[220px_minmax(0,1fr)]">
      <div onClick={onOpen} className="relative min-h-36 cursor-pointer bg-elevated sm:min-h-full" aria-hidden>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- a redirect to Google's image host; next/image can't proxy it.
          <img src={photoUrl(photo, 480)} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
        ) : (
          <BedDouble size={28} className="absolute inset-0 m-auto text-stone" aria-hidden />
        )}
      </div>
      <div className="grid min-w-0 gap-4 p-4 sm:p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {rating !== null && (
              <span className="tnum inline-flex items-center gap-1 font-mono text-[12px] text-body">
                <Star size={12} className="fill-warn text-warn" aria-hidden /> {rating.toFixed(1)}
                {place?.ratingCount ? <span className="text-mute">({place.ratingCount.toLocaleString("en-US")})</span> : null}
                {place?.priceLevel ? <span className="text-mute"> · {place.priceLevel}</span> : null}
              </span>
            )}
            {stay.status === "booked" && <Pill dot="ok">Booked</Pill>}
            {stay.status === "planned" && <Pill dot="warn">{stay.details.reserve ? "To book" : "Planned"}</Pill>}
            {cancelled && <Pill dot="danger">Cancelled</Pill>}
          </div>
          <button type="button" onClick={onOpen} className={`mt-1.5 block cursor-pointer text-left font-serif text-[22px] leading-tight hover:underline ${cancelled ? "text-ash line-through" : "text-ink"}`}>
            {stay.title}
          </button>
          {address && <p className="mt-1 text-[13px] text-mute">{address}</p>}
          {(place?.summary ?? stay.details.note) && <p className="mt-2 max-w-[60ch] whitespace-pre-line text-[14px] leading-relaxed text-body [text-wrap:pretty]">{place?.summary ?? stay.details.note}</p>}
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-md bg-elevated px-3.5 py-3">
          <div className="min-w-0">
            <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-mute">Check-in</div>
            <div className="tnum mt-1.5 font-mono text-[15px] font-medium text-ink">{day(stay.startDate)}</div>
            <div className="tnum font-mono text-[12px] text-mute">{stay.startTime ? `from ${time12(stay.startTime)}` : " "}</div>
          </div>
          <div className="tnum text-center font-mono text-[12px] text-mute">
            <b className="block text-[18px] font-medium text-ink">{n ?? "—"}</b>
            {n === 1 ? "night" : "nights"}
          </div>
          <div className="min-w-0 text-right">
            <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-mute">Check-out</div>
            <div className="tnum mt-1.5 font-mono text-[15px] font-medium text-ink">{stay.endDate ? day(stay.endDate) : "—"}</div>
            <div className="tnum font-mono text-[12px] text-mute">{stay.endTime ? `by ${time12(stay.endTime)}` : " "}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Fact label="Confirmation">{stay.confirmation ? <CopyCode code={stay.confirmation} /> : "—"}</Fact>
          <Fact label="Guests">{stay.details.guests ?? "—"}</Fact>
          <Fact label={stay.details.price !== undefined ? "Total" : "Estimate"}>{price !== undefined ? amount(price, stay.details.currency) : "—"}</Fact>
        </div>

        {(maps || phone || site) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            {maps && (
              <a href={maps} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                Directions <ExternalLink size={11} aria-hidden />
              </a>
            )}
            {phone && (
              <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="tnum text-accent hover:underline">
                {phone}
              </a>
            )}
            {site && (
              <a href={site} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                {place?.website ? "Website" : "Booking"} <ExternalLink size={11} aria-hidden />
              </a>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

type Props = { trip: TripDetail; onOpenItem: (id: string) => void; onAdd: () => void };

export function HotelsTab({ trip, onOpenItem, onAdd }: Props) {
  const stays = trip.items.filter((i) => i.kind === "stay" && i.status !== "suggested").sort(byItinerary);
  const gaps = nights(trip).filter((r) => !r.stay);
  return (
    <div className="space-y-6">
      <TabHead title="Hotels" sub={stays.length ? "Every stay on the trip, with check-in times and how to reach the front desk." : undefined}>
        <Button size="sm" variant="ghost" onClick={onAdd}>
          <Plus size={14} /> Add stay
        </Button>
      </TabHead>
      {stays.length === 0 && (
        <EmptyState icon={<BedDouble size={18} />} title="No hotels yet" body="Forward a booking confirmation to your Lodestar address, or add a stay by hand. For ideas with live prices, use Find hotels on the Itinerary tab.">
          <Button size="sm" variant="primary" onClick={onAdd}>
            <Plus size={14} /> Add stay
          </Button>
        </EmptyState>
      )}
      <div className="space-y-4">
        {stays.map((s) => (
          <HotelCard key={s.id} stay={s} onOpen={() => onOpenItem(s.id)} />
        ))}
      </div>
      {stays.length > 0 && gaps.length > 0 && (
        <p className="rounded-xl border border-dashed border-hairline-strong px-4 py-3 text-[13px] text-mute">
          No hotel yet for {gaps.map((g) => (g.nights === 1 ? `the night of ${shortDate(g.from)}` : `${shortDate(g.from)} to ${shortDate(g.to)}`)).join(", ")}.
        </p>
      )}
    </div>
  );
}
