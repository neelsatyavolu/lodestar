import { BedDouble, Check, Phone, Plane, StickyNote, Ticket, TrainFront, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { addDays, day } from "@/lib/format";
import { bookings, nights, toBook } from "@/lib/journeys/plan";
import type { SharedTrip } from "@/lib/journeys/share";
import type { Item, Kind } from "@/lib/journeys/types";
import { time12 } from "../journeys/shared";
import { ShareMap } from "./share-map";

// The read-only page a share link opens: what family or friends need to follow
// the trip. Server-rendered from data already stripped of anything private.

const ICON: Record<Kind, typeof Plane> = { flight: Plane, stay: BedDouble, dining: UtensilsCrossed, activity: Ticket, transport: TrainFront, note: StickyNote };
const KIND_HEADING: Record<Kind, string> = { flight: "Flights", stay: "Stays", transport: "Getting around", activity: "Activities", dining: "Restaurants", note: "Notes" };

const short = (iso: string) => day(iso).replace(/^\w+, /, "");
const span = (a: string | null, b: string | null) => (!a ? "Dates to be set" : !b || a === b ? `${short(a)}, ${a.slice(0, 4)}` : `${short(a)} – ${short(b)}, ${b.slice(0, 4)}`);

function days(t: SharedTrip): string[] {
  const set = new Set(t.items.map((i) => i.startDate));
  if (t.startDate) for (let d = t.startDate; d <= (t.endDate ?? t.startDate) && set.size < 60; d = addDays(d, 1)) set.add(d);
  return [...set].sort();
}

const firm = (i: Item) => i.status !== "cancelled";
const byTime = (a: Item, b: Item) => (a.startTime ?? "").localeCompare(b.startTime ?? "");

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-hairline pt-8 first:border-t-0 first:pt-0">
      <h2 className="font-display text-[28px] text-ink">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Stop({ item }: { item: Item }) {
  const Icon = ICON[item.kind];
  const sub = [item.kind === "flight" && item.endTime ? `arrives ${time12(item.endTime)}` : null, item.kind === "stay" && item.endDate ? `check-out ${short(item.endDate)}` : null, item.details.address ?? item.place].filter(Boolean).join(" · ");
  return (
    <li className="flex gap-3 py-3">
      <span className="tnum w-16 shrink-0 whitespace-nowrap pt-0.5 font-mono text-[12px] text-ash">{item.startTime ? time12(item.startTime) : ""}</span>
      <Icon size={16} className="mt-0.5 shrink-0 text-charcoal" aria-hidden />
      <div className="min-w-0">
        <p className="text-[15px] text-ink">
          {item.title}
          {item.status === "booked" && <span className="ml-2 text-[12px] text-ok">Booked</span>}
          {item.status === "planned" && item.details.reserve && <span className="ml-2 text-[12px] text-warn">To book</span>}
        </p>
        {sub && <p className="mt-1 text-[13px] text-mute">{sub}</p>}
        {item.details.note && <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-body">{item.details.note}</p>}
      </div>
    </li>
  );
}

/** `embedded`: inside the app (under its header) for someone the trip was shared with view-only; `label` replaces the "shared from Lodestar" line. */
export function SharedTripView({ trip, today, embedded = false, label, top }: { trip: SharedTrip; today: string; embedded?: boolean; label?: string; top?: React.ReactNode }) {
  const runs = nights(trip);
  const open = toBook(trip.items);
  const booked = bookings(trip.items);
  const sections = trip.tasks.reduce<Map<string, typeof trip.tasks>>((m, t) => m.set(t.section, [...(m.get(t.section) ?? []), t]), new Map());
  const nav = [
    ["overview", "Overview"],
    ["itinerary", "Itinerary"],
    ...(open.length ? [["to-book", "To book"]] : []),
    ...(booked.length ? [["bookings", "Bookings"]] : []),
    ...(trip.tasks.length ? [["checklist", "Checklist"]] : []),
  ];

  return (
    <main className={`mx-auto w-full max-w-3xl flex-1 pb-24 ${embedded ? "" : "px-4 sm:px-6"}`}>
      <header className={embedded ? "pt-6" : "pt-12 sm:pt-16"}>
        {top}
        <p className="text-[13px] text-mute">{label ?? "A trip shared from Lodestar · read only"}</p>
        <h1 className="mt-3 font-display text-[clamp(34px,6vw,52px)] leading-tight text-ink">{trip.title}</h1>
        <p className="mt-2 text-[16px] text-body">{[trip.destination, span(trip.startDate, trip.endDate), trip.travelers ? `${trip.travelers} ${trip.travelers === 1 ? "traveller" : "travellers"}` : null].filter(Boolean).join(" · ")}</p>
      </header>

      <nav aria-label="Sections" className={`sticky ${embedded ? "top-16" : "top-0"} z-10 -mx-4 mt-8 flex gap-1 overflow-x-auto border-b border-hairline bg-canvas px-4 py-2 sm:-mx-6 sm:px-6`}>
        {nav.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="inline-flex h-9 items-center whitespace-nowrap rounded-full px-3 text-[13px] text-mute hover:bg-hover hover:text-ink pointer-coarse:h-11">
            {label}
          </a>
        ))}
      </nav>

      <div className="mt-8 space-y-12">
        <Section id="overview" title="Overview">
          {runs.length > 0 && (
            <>
              <h3 className="text-[13px] font-medium text-charcoal">Where you&apos;ll sleep</h3>
              <ol className="mt-2 divide-y divide-hairline rounded-xl border border-hairline bg-card">
                {runs.map((r) => (
                  <li key={r.from} className="flex items-baseline justify-between gap-4 px-4 py-3">
                    <span className={`text-[15px] ${r.stay ? "text-ink" : "text-mute"}`}>{r.stay?.title ?? "Not decided yet"}</span>
                    <span className="shrink-0 text-[13px] text-mute">
                      {short(r.from)} – {short(r.to)} · {r.nights} {r.nights === 1 ? "night" : "nights"}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
          {trip.notes.length > 0 && (
            <div className="mt-6 space-y-4">
              {trip.notes.map((n) => (
                <article key={n.id} className="rounded-xl border border-hairline bg-card px-5 py-4">
                  <h3 className="text-[15px] font-medium text-ink">{n.title}</h3>
                  <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-body">{n.body}</p>
                </article>
              ))}
            </div>
          )}
          {!runs.length && !trip.notes.length && <p className="text-[14px] text-mute">The day-by-day plan is below.</p>}
        </Section>

        <Section id="itinerary" title="Itinerary">
          {trip.items.some((i) => i.details.lat !== undefined) && (
            <div className="mb-6 h-[320px] overflow-hidden rounded-xl border border-hairline">
              <ShareMap items={trip.items} />
            </div>
          )}
          <ol className="space-y-8">
            {days(trip).map((d, n) => {
              const list = trip.items.filter((i) => i.startDate === d && firm(i)).sort(byTime);
              return (
                <li key={d}>
                  <h3 className={`flex items-baseline gap-3 border-b border-hairline pb-2 text-[15px] font-medium ${d === today ? "text-accent" : "text-ink"}`}>
                    {day(d)}
                    {trip.startDate && <span className="text-[12px] font-normal text-ash">Day {n + 1}</span>}
                  </h3>
                  {list.length ? <ul>{list.map((i) => <Stop key={i.id} item={i} />)}</ul> : <p className="py-3 text-[13px] text-ash">Nothing planned yet.</p>}
                </li>
              );
            })}
          </ol>
        </Section>

        {open.length > 0 && (
          <Section id="to-book" title="To book">
            <ul className="divide-y divide-hairline rounded-xl border border-hairline bg-card">
              {open.map((i) => (
                <li key={i.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="text-[15px] text-ink">{i.title}</span>
                    <span className={`text-[13px] ${i.details.bookBy && i.details.bookBy < today ? "text-danger" : "text-mute"}`}>
                      {i.details.bookBy ? `Book by ${short(i.details.bookBy)}` : `For ${short(i.startDate)}`}
                    </span>
                  </div>
                  <p className="mt-1 flex flex-wrap gap-x-3 text-[13px] text-mute">
                    <span>{[short(i.startDate), i.startTime && time12(i.startTime), i.place].filter(Boolean).join(" · ")}</span>
                    {i.details.phone && (
                      <a href={`tel:${i.details.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 text-accent hover:underline">
                        <Phone size={12} aria-hidden /> {i.details.phone}
                      </a>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {booked.length > 0 && (
          <Section id="bookings" title="Bookings">
            <div className="space-y-6">
              {booked.map((g) => (
                <div key={g.kind}>
                  <h3 className="text-[13px] font-medium text-charcoal">{KIND_HEADING[g.kind]}</h3>
                  <ul className="mt-1">
                    {g.items.map((i) => (
                      <li key={i.id} className="flex items-baseline justify-between gap-4 border-b border-hairline py-3 last:border-0">
                        <span className={`text-[15px] ${i.status === "cancelled" ? "text-ash line-through" : "text-ink"}`}>{i.title}</span>
                        <span className="shrink-0 text-[13px] text-mute">{[short(i.startDate), i.startTime && time12(i.startTime)].filter(Boolean).join(" · ")}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="mt-4 text-[12px] text-ash">Confirmation numbers and prices stay with the trip&apos;s owner.</p>
          </Section>
        )}

        {trip.tasks.length > 0 && (
          <Section id="checklist" title="Checklist">
            <div className="space-y-6">
              {[...sections].map(([section, tasks]) => (
                <div key={section}>
                  <h3 className="text-[13px] font-medium text-charcoal">{section}</h3>
                  <ul className="mt-2 space-y-2">
                    {tasks.map((t) => (
                      <li key={t.id} className="flex items-start gap-3 text-[14px]">
                        <span className={`mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded border ${t.done ? "border-accent bg-accent text-accent-on" : "border-hairline-strong"}`} role="img" aria-label={t.done ? "Done" : "Not done"}>
                          {t.done && <Check size={11} strokeWidth={3} />}
                        </span>
                        <span className={t.done ? "text-ash line-through" : "text-body"}>
                          {t.title}
                          {t.due && <span className="ml-2 text-[12px] text-mute">by {short(t.due)}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>

      <footer className="mt-16 border-t border-hairline pt-6 text-[12px] text-ash">
        Planned with{" "}
        <Link href="/" className="text-charcoal hover:text-ink">
          Lodestar
        </Link>
        .
      </footer>
    </main>
  );
}
