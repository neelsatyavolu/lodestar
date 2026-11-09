import { CalendarClock, Check, ExternalLink, Phone, X } from "lucide-react";
import { useState } from "react";
import { toBook } from "@/lib/journeys/plan";
import type { Item, TripDetail } from "@/lib/journeys/types";
import { Dialog, Field, inputClass } from "../dialog";
import { Button } from "../ui";
import { AiButton, AiStatus, EmptyState, TabHead, type Generator } from "./ai-draft";
import { DateField } from "./date-field";
import { day } from "@/lib/format";
import { amount, deadline, errorText, patchItem, timeRange } from "./shared";

// Everything still to reserve, soonest deadline first: when it is, when to
// book by, how to book (phone, link), and one tap to mark it booked.

const TONE = { danger: "text-danger", warn: "text-warn" } as const;

function MarkBooked({ item, onClose, onDone }: { item: Item | null; onClose: () => void; onDone: (i: Item) => void }) {
  const [code, setCode] = useState("");
  const [price, setPrice] = useState(item?.details.estimate ? String(item.details.estimate) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!item) return;
    const paid = price.trim() ? Number(price) : null;
    if (paid !== null && (!Number.isFinite(paid) || paid < 0)) return setError("Enter the price as a number.");
    setBusy(true);
    setError(null);
    try {
      onDone(await patchItem(item.id, { status: "booked", confirmation: code.trim() || null, facts: paid === null ? {} : { price: paid, estimate: null } }));
    } catch (err) {
      setError(errorText(err, "Couldn't mark it booked."));
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={Boolean(item)}
      onClose={onClose}
      title={item ? `Booked ${item.title}` : ""}
      width={440}
      footer={
        <div className="flex items-center justify-end gap-2">
          {error && <p className="mr-auto text-[13px] text-danger">{error}</p>}
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy} onClick={save}>
            <Check size={14} /> Mark booked
          </Button>
        </div>
      }
    >
      <form
        className="space-y-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Confirmation number (optional)">
          <input autoFocus value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} className={`${inputClass} font-mono`} />
        </Field>
        <Field label="What you paid (optional)" hint="Goes into the budget as paid.">
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" className={`${inputClass} tnum`} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function BookCard({ item, onOpen, onBook, onChanged, onError }: { item: Item; onOpen: () => void; onBook: () => void; onChanged: (i: Item) => void; onError: (e: string) => void }) {
  const [busy, setBusy] = useState(false);
  const due = deadline(item.details.bookBy);
  const d = item.details;
  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      onChanged(await patchItem(item.id, body));
    } catch (err) {
      onError(errorText(err, "Couldn't update it."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="rounded-xl border border-hairline-strong bg-card">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 pb-3 pt-4">
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onOpen} className="cursor-pointer text-left text-[15px] font-medium text-ink hover:underline">
            {item.title}
          </button>
          <p className="mt-1 text-[13px] text-mute">
            {[`${day(item.startDate)}${item.startTime ? ` · ${timeRange(item)}` : ""}`, d.address ?? item.place].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="shrink-0 text-right">
          {due ? <p className={`text-[13px] font-medium ${due.tone ? TONE[due.tone] : "text-body"}`}>{due.text}</p> : <p className="text-[13px] text-ash">No deadline</p>}
          {d.estimate !== undefined && <p className="tnum mt-1 text-[12px] text-mute">about {amount(d.estimate, d.currency)}</p>}
        </div>
      </div>
      {(d.note || d.why) && <p className="max-w-[65ch] px-5 pb-3 text-[13px] leading-relaxed text-body [text-wrap:pretty]">{d.note ?? d.why}</p>}
      <div className="flex flex-wrap items-center gap-2 border-t border-hairline px-4 py-3">
        <Button size="sm" variant="primary" disabled={busy} onClick={onBook}>
          <Check size={14} /> Mark booked
        </Button>
        {d.url && (
          <a href={d.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 pointer-coarse:h-11 items-center gap-2 rounded-md border border-hairline-strong bg-elevated px-3 text-[13px] font-medium text-ink hover:border-hairline-hover">
            Reserve <ExternalLink size={12} aria-hidden />
          </a>
        )}
        {d.phone && (
          <a href={`tel:${d.phone.replace(/[^\d+]/g, "")}`} className="inline-flex h-8 pointer-coarse:h-11 items-center gap-2 px-2 text-[13px] text-charcoal hover:text-ink">
            <Phone size={13} aria-hidden /> <span className="tnum">{d.phone}</span>
          </a>
        )}
        <div className="ml-auto flex items-center gap-1">
          <DateField label="Book by" value={d.bookBy ?? null} onChange={(v) => patch({ facts: { bookBy: v } })} compact icon={<CalendarClock size={14} />} />
          <button type="button" disabled={busy} onClick={() => patch({ facts: { reserve: null, bookBy: null } })} title="Doesn't need booking" aria-label={`${item.title} doesn't need booking`} className="inline-flex size-9 pointer-coarse:size-11 cursor-pointer items-center justify-center rounded-md text-ash hover:text-ink">
            <X size={14} />
          </button>
        </div>
      </div>
    </li>
  );
}

export function ToBookTab({ trip, gen, onOpenItem, onReplace }: { trip: TripDetail; gen: Generator; onOpenItem: (id: string) => void; onReplace: (i: Item) => void }) {
  const [marking, setMarking] = useState<Item | null>(null);
  const [markKey, setMarkKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const list = toBook(trip.items);
  const overdue = list.filter((i) => deadline(i.details.bookBy)?.tone === "danger").length;

  return (
    <div className="space-y-5">
      <TabHead title="To book" sub={list.length ? `${list.length} to reserve${overdue ? `, ${overdue} past due` : ""}. Soonest deadline first.` : "Restaurants, tours, spa slots, cars: anything that needs a reservation."}>
        {list.length > 0 && <AiButton gen={gen} part="to_book" label="Check for more" />}
      </TabHead>
      <AiStatus gen={gen} parts={["to_book"]} />
      {error && <p className="text-[13px] text-danger">{error}</p>}
      {list.length === 0 ? (
        <EmptyState icon={<CalendarClock size={18} />} title="Nothing to book yet" body="Your AI can go through the itinerary and flag what needs a reservation and by when. You can also mark any planned stop as needing booking from the Itinerary.">
          <AiButton gen={gen} part="to_book" variant="primary" />
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {list.map((i) => (
            <BookCard
              key={i.id}
              item={i}
              onOpen={() => onOpenItem(i.id)}
              onBook={() => {
                setMarkKey((k) => k + 1);
                setMarking(i);
              }}
              onChanged={onReplace}
              onError={setError}
            />
          ))}
        </ul>
      )}
      <MarkBooked
        key={markKey}
        item={marking}
        onClose={() => setMarking(null)}
        onDone={(i) => {
          onReplace(i);
          setMarking(null);
        }}
      />
    </div>
  );
}
