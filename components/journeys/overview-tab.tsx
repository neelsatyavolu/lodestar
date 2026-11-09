import { AlertTriangle, BedDouble, CarFront, Info, MapPinned, Plane, Ticket, TrainFront, UtensilsCrossed } from "lucide-react";
import { useState } from "react";
import { budget, issues, nights, toBook } from "@/lib/journeys/plan";
import type { Item, Kind, Note, TripDetail } from "@/lib/journeys/types";
import { AiButton, type Generator } from "./ai-draft";
import { Collapsible } from "./collapsible";
import { ItemRow } from "./item-row";
import { NotesSection } from "./notes-section";
import { amount, shortDate, today } from "./shared";
import type { Tab } from "./tabs";

// The trip at a glance, laid out like Wanderlog's Overview: reservations and
// budget up top, then what to sort out, notes, where you sleep, and places to
// visit, each foldable.

export type AddPreset = { kind: Exclude<Kind, "note">; title?: string };

type Props = {
  trip: TripDetail;
  gen: Generator;
  selectedId: string | null;
  onOpenItem: (id: string) => void;
  onTab: (t: Tab) => void;
  onAdd: (preset: AddPreset) => void;
  onNotes: (update: (n: Note[]) => Note[]) => void;
  onReplace: (i: Item) => void;
  onDrop: (id: string) => void;
};

const isCar = (i: Item) => i.kind === "transport" && /car|rental|hertz|avis|alamo|enterprise|national|budget|sixt/i.test(`${i.title} ${i.details.provider ?? ""}`);

const RESERVE: { label: string; icon: typeof Plane; preset: AddPreset; count: (items: Item[]) => number }[] = [
  { label: "Flight", icon: Plane, preset: { kind: "flight" }, count: (xs) => xs.filter((i) => i.kind === "flight").length },
  { label: "Stay", icon: BedDouble, preset: { kind: "stay" }, count: (xs) => xs.filter((i) => i.kind === "stay").length },
  { label: "Rental car", icon: CarFront, preset: { kind: "transport", title: "Rental car" }, count: (xs) => xs.filter(isCar).length },
  { label: "Transport", icon: TrainFront, preset: { kind: "transport" }, count: (xs) => xs.filter((i) => i.kind === "transport" && !isCar(i)).length },
  { label: "Activity", icon: Ticket, preset: { kind: "activity" }, count: (xs) => xs.filter((i) => i.kind === "activity").length },
  { label: "Dining", icon: UtensilsCrossed, preset: { kind: "dining" }, count: (xs) => xs.filter((i) => i.kind === "dining").length },
];

export function OverviewTab({ trip, gen, selectedId, onOpenItem, onTab, onAdd, onNotes, onReplace, onDrop }: Props) {
  const [open, setOpen] = useState({ sort: true, notes: true, lodging: true, places: true });
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const toggle = (k: keyof typeof open) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const found = issues(trip, today());
  const runs = nights(trip);
  const b = budget(trip);
  const booked = trip.items.filter((i) => i.status === "booked");
  const pending = toBook(trip.items).length;
  const totalNights = runs.reduce((n, r) => n + r.nights, 0);
  const places = trip.items.filter((i) => (i.kind === "activity" || i.kind === "dining") && (i.status === "suggested" || (i.status === "planned" && !i.startTime)));
  const warnings = found.filter((f) => f.level === "warn").length;

  return (
    <div className="space-y-12">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section aria-labelledby="res-head" className="rounded-xl border border-hairline-strong bg-card p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id="res-head" className="text-[15px] font-medium text-ink">
              Reservations
            </h3>
            <button type="button" onClick={() => onTab("bookings")} className="shrink-0 cursor-pointer text-[12px] text-accent hover:underline pointer-coarse:min-h-11">
              {booked.length} booked{pending ? ` · ${pending} to book` : ""}
            </button>
          </div>
          <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {RESERVE.map((r) => {
              const n = r.count(booked);
              return (
                <li key={r.label}>
                  <button type="button" onClick={() => onAdd(r.preset)} aria-label={`Add ${r.label.toLowerCase()}${n ? `, ${n} booked` : ""}`} className="flex h-16 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg text-charcoal transition-transform duration-150 hover:bg-hover hover:text-ink active:scale-[0.96]">
                    <span className="relative">
                      <r.icon size={18} aria-hidden />
                      {n > 0 && <span className="tnum absolute -right-3.5 -top-2 min-w-[17px] rounded-full bg-accent px-1 text-center text-[10px] font-semibold leading-[17px] text-accent-on">{n}</span>}
                    </span>
                    <span className="text-[12px]">{r.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
        <section aria-labelledby="budget-head" className="flex flex-col rounded-xl border border-hairline-strong bg-card p-4">
          <h3 id="budget-head" className="text-[15px] font-medium text-ink">
            Budget
          </h3>
          <p className="tnum mt-2 text-[28px] font-medium leading-none tracking-[-0.02em] text-ink">{b.total ? amount(b.total, b.currency) : amount(0, b.currency)}</p>
          <p className="tnum mt-2 text-[12px] text-mute">{b.total ? `${amount(b.paid, b.currency)} paid${b.perPerson ? ` · ${amount(b.perPerson, b.currency)} each` : ""}` : "Nothing priced yet"}</p>
          <button type="button" onClick={() => onTab("budget")} className="mt-auto cursor-pointer self-start pt-3 text-[13px] text-accent hover:underline pointer-coarse:min-h-11">
            View details
          </button>
        </section>
      </div>

      {found.length > 0 && (
        <Collapsible title="To sort out" open={open.sort} onToggle={() => toggle("sort")} aside={warnings > 0 && <span className="tnum rounded-full bg-elevated px-2 text-[12px] leading-5 text-body">{warnings}</span>}>
          <ul className="divide-y divide-hairline overflow-hidden rounded-xl border border-hairline-strong bg-card">
            {found.map((x, k) => {
              const Icon = x.level === "warn" ? AlertTriangle : Info;
              const row = (
                <>
                  <Icon size={15} className={`mt-0.5 shrink-0 ${x.level === "warn" ? "text-warn" : "text-ash"}`} aria-hidden />
                  <span className={`min-w-0 flex-1 text-[14px] [text-wrap:pretty] ${x.level === "warn" ? "text-body" : "text-mute"}`}>{x.text}</span>
                </>
              );
              return (
                <li key={k}>
                  {x.itemId ? (
                    <button type="button" onClick={() => onOpenItem(x.itemId!)} className="flex w-full cursor-pointer gap-3 px-4 py-3 text-left hover:bg-hover">
                      {row}
                      <span className="shrink-0 text-[12px] text-accent">Open</span>
                    </button>
                  ) : (
                    <div className="flex gap-3 px-4 py-3">{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </Collapsible>
      )}

      <Collapsible
        title="Notes"
        open={open.notes}
        onToggle={() => toggle("notes")}
        menu={[
          { label: "Add a note", onSelect: () => (setOpen((o) => ({ ...o, notes: true })), setEditingNote("new")) },
          { label: "Write notes with AI", onSelect: () => gen.run("notes") },
        ]}
      >
        <NotesSection journeyId={trip.id} notes={trip.notes} gen={gen} onNotes={onNotes} editing={editingNote} setEditing={setEditingNote} />
      </Collapsible>

      {runs.length > 0 && (
        <Collapsible
          title="Hotels and lodging"
          open={open.lodging}
          onToggle={() => toggle("lodging")}
          aside={<span className="tnum text-[12px] text-ash">{totalNights === 1 ? "1 night" : `${totalNights} nights`}</span>}
          menu={[
            { label: "Add a stay", onSelect: () => onAdd({ kind: "stay" }) },
            { label: "See it day by day", onSelect: () => onTab("itinerary") },
          ]}
        >
          <ol className="space-y-2">
            {runs.map((r) => (
              <li key={r.from}>
                <button
                  type="button"
                  onClick={() => (r.stay ? onOpenItem(r.stay.id) : onAdd({ kind: "stay" }))}
                  className={`flex w-full cursor-pointer items-center gap-4 rounded-xl border px-4 py-3 text-left ${r.stay ? "border-hairline-strong bg-card hover:border-hairline-hover" : "border-dashed border-hairline-strong hover:border-hairline-hover"}`}
                >
                  <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${r.stay ? "bg-elevated text-charcoal" : "border border-dashed border-hairline-strong text-ash"}`}>
                    <BedDouble size={16} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[14px] ${r.stay ? "text-ink" : "text-body"}`}>{r.stay?.title ?? "No stay yet"}</span>
                    <span className={`block truncate text-[12px] ${r.stay ? "text-mute" : "text-accent"}`}>{r.stay ? [r.stay.place, r.stay.status === "booked" ? "Booked" : "Planned, not booked"].filter(Boolean).join(" · ") : "Add a place to stay"}</span>
                  </span>
                  <span className="tnum shrink-0 text-right text-[12px] text-mute">
                    {shortDate(r.from)} – {shortDate(r.to)}
                    <span className="block text-ash">{r.nights === 1 ? "1 night" : `${r.nights} nights`}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </Collapsible>
      )}

      <Collapsible
        title="Places to visit"
        open={open.places}
        onToggle={() => toggle("places")}
        aside={places.length > 0 && <span className="tnum text-[12px] text-ash">{places.length}</span>}
        menu={[
          { label: "Suggest places with AI", onSelect: () => gen.run("itinerary") },
          { label: "Add an activity", onSelect: () => onAdd({ kind: "activity" }) },
        ]}
      >
        {places.length ? (
          <ul className="space-y-1">
            {places.map((i) => (
              <ItemRow key={i.id} item={i} selected={i.id === selectedId} onOpen={() => onOpenItem(i.id)} onChanged={onReplace} onRemoved={() => onDrop(i.id)} />
            ))}
          </ul>
        ) : (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-hairline-strong px-4 py-4">
            <MapPinned size={16} className="shrink-0 text-ash" aria-hidden />
            <p className="min-w-0 flex-1 text-[13px] text-mute">Ideas without a time land here: places to eat and things to do you might fit in.</p>
            <AiButton gen={gen} part="itinerary" label="Suggest places" />
          </div>
        )}
      </Collapsible>
    </div>
  );
}
