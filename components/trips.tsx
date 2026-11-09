import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { TripSummary } from "@/lib/db/trips";
import { ApiError, api } from "@/lib/client";
import { day, money } from "@/lib/format";
import { creditVerdict, type Booking } from "@/lib/trips/booked";
import type { Snapshot } from "@/lib/trips/input";
import type { Itinerary } from "@/lib/types";
import type { VerifiedSeller } from "@/lib/verify";
import { BoardView, type Board } from "./ai-canvas";
import { Dialog } from "./dialog";
import type { SellerCheck } from "./itinerary-card";
import type { Fare } from "./sellers-panel";
import { Button, Toggle } from "./ui";
import { askConfirm } from "./confirm";

// Saved Plan shortlists, each with its email alerts: price drops, a target
// fare and a book-by reminder. A daily check re-runs the trip's searches.
// Once booked, it watches the booked fare and says whether a drop can come back.

type Shared = { checks: Record<string, SellerCheck>; onCheck: (it: Itinerary) => void; trustedOnly: boolean };

const inputClass = "h-9 rounded-md border border-hairline-hover bg-card px-2.5 text-[14px] text-ink outline-none focus:border-accent";
const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
/** Google's policy words, kept only when they're ones the booking API accepts. */
const oneOf = <T extends string>(v: string | null, allowed: readonly T[]): T | null => (allowed.includes(v as T) ? (v as T) : null);

export function Trips({ focus, onPlan, embedded = false, ...shared }: Shared & { focus: string | null; onPlan: () => void; embedded?: boolean }) {
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ trips: TripSummary[] }>("/api/trips")
      .then((r) => setTrips(r.trips))
      .catch((err) => setError(errorText(err, "Couldn't load your trips.")));
  }, [focus]);

  const replace = (t: TripSummary) => setTrips((ts) => ts?.map((x) => (x.id === t.id ? t : x)) ?? ts);
  const remove = (id: string) => setTrips((ts) => ts?.filter((x) => x.id !== id) ?? ts);

  // Inside the trip organizer, shortlists are one section that only shows once there is one.
  if (embedded && !error && !trips?.length) return null;

  return (
    <section className={embedded ? "" : "pt-10 sm:pt-16"}>
      {embedded ? (
        <>
          <h2 className="text-[13px] font-medium text-ink">Watching fares</h2>
          <p className="mt-1 text-[13px] text-mute">Shortlists saved from Plan. Lodestar checks their fares daily and emails you when an alert fires.</p>
        </>
      ) : (
        <>
          <h1 className="font-display text-[clamp(32px,5vw,48px)]">Trips</h1>
          <p className="mt-3 max-w-xl text-[16px] leading-relaxed text-body">Shortlists you saved from Plan. Lodestar checks their fares every day and emails you when an alert fires.</p>
        </>
      )}
      <div className={embedded ? "mt-3 space-y-4" : "mt-8 space-y-4"}>
        {error && <p className="text-[13px] text-danger">{error}</p>}
        {!trips && !error && <p className="text-[13px] text-mute">Loading…</p>}
        {trips?.length === 0 && (
          <div className="rounded-lg border border-hairline-strong bg-card p-6 text-[14px] text-mute">
            No saved trips yet. Ask Plan for a trip, then press <span className="text-ink">Save trip and get alerts</span> on the shortlist.{" "}
            <button type="button" onClick={onPlan} className="cursor-pointer text-accent hover:underline">
              Open Plan
            </button>
          </div>
        )}
        {trips?.map((t) => <TripCard key={t.id} trip={t} focused={t.id === focus} onChange={replace} onDelete={() => remove(t.id)} {...shared} />)}
      </div>
    </section>
  );
}

function TripCard({ trip, focused, onChange, onDelete, ...shared }: Shared & { trip: TripSummary; focused: boolean; onChange: (t: TripSummary) => void; onDelete: () => void }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [open, setOpen] = useState(focused);
  const [target, setTarget] = useState(trip.targetPrice?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState<Booking | null>(null);
  const departed = trip.firstDepart <= new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (focused) document.getElementById(`trip-${trip.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focused, trip.id]);

  useEffect(() => {
    if (!open || board) return;
    api<{ snapshot: Snapshot }>(`/api/trips/${trip.id}`)
      .then(({ snapshot: s }) =>
        setBoard({
          prompt: s.prompt,
          plan: s.plan,
          canvas: s.canvas,
          options: s.options as unknown as Board["options"],
          hacks: s.hacks as unknown as Board["hacks"],
          searches: s.searches.map((x) => ({ state: x.state, count: x.count ?? undefined, cheapest: x.cheapest, error: x.error ?? undefined })),
          status: null,
          error: null,
          running: false,
        }),
      )
      .catch((err) => setError(errorText(err, "Couldn't load the shortlist.")));
  }, [open, board, trip.id]);

  const update = async (change: Partial<Pick<TripSummary, "alertDrop" | "targetPrice" | "remindOn">>) => {
    setError(null);
    try {
      const { trip: next } = await api<{ trip: TripSummary }>(`/api/trips/${trip.id}`, { method: "PATCH", body: JSON.stringify(change) });
      onChange(next);
    } catch (err) {
      setError(errorText(err, "Couldn't update the alert."));
    }
  };

  const saveTarget = () => {
    const value = target.trim() ? Number(target.replace(/[$,\s]/g, "")) : null;
    if (value !== null && !(value > 0)) return setError("Enter a price in dollars, like 1500.");
    if (value !== trip.targetPrice) update({ targetPrice: value });
  };

  const del = async () => {
    if (!(await askConfirm(`Delete ${trip.title}?`, "Delete", "Its alerts stop too."))) return;
    try {
      await api(`/api/trips/${trip.id}`, { method: "DELETE" });
      onDelete();
    } catch (err) {
      setError(errorText(err, "Couldn't delete the trip."));
    }
  };

  const startBooking = (it: Itinerary, seller: VerifiedSeller, fare: Fare) => {
    if (!it.tfs) return;
    setMarking({ tfs: it.tfs, seller: seller.name, isAirline: seller.is_airline, fare: fare.name, paid: fare.price, changes: oneOf(fare.policy.changes, ["free", "fee", "none"]), refunds: oneOf(fare.policy.refunds, ["full", "partial", "none"]) });
  };

  /** Saves or clears the booking; returns the error to show, if any. */
  const setBooked = async (b: Booking | null): Promise<string | null> => {
    try {
      const { trip: next } = await api<{ trip: TripSummary }>(`/api/trips/${trip.id}/booking`, b ? { method: "PUT", body: JSON.stringify(b) } : { method: "DELETE" });
      onChange(next);
      setMarking(null);
      // Booking clears the target on the server; keep the input in step for an undo.
      setTarget(next.targetPrice?.toString() ?? "");
      return null;
    } catch (err) {
      return errorText(err, b ? "Couldn't mark the trip booked." : "Couldn't undo the booking.");
    }
  };

  const booking = trip.booking;
  const basePrice = booking?.paid ?? trip.savedPrice;
  const change = trip.lastPrice !== null ? trip.lastPrice - basePrice : null;

  return (
    <article id={`trip-${trip.id}`} className={`scroll-mt-24 rounded-lg border bg-card p-5 ${focused ? "border-accent" : "border-hairline-strong"}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-mono text-[15px] text-ink">{trip.title}</h2>
          <p className="mt-1 truncate text-[13px] text-mute">{trip.prompt}</p>
        </div>
        <div className="text-right text-[13px] tnum">
          <p className="text-ink">
            {trip.lastPrice !== null ? `Now ${money(trip.lastPrice)}` : booking ? `Paid ${money(booking.paid)}` : `Saved at ${money(trip.savedPrice)}`}
            {change !== null && change !== 0 && <span className={change < 0 ? "text-ok" : "text-mute"}> {change < 0 ? `−${money(-change)}` : `+${money(change)}`}</span>}
          </p>
          <p className="text-xs text-ash">{trip.checkedAt ? `Checked ${day(new Date(trip.checkedAt).toISOString().slice(0, 10))}` : "First check within a day"}</p>
        </div>
      </div>

      {booking && <BookedSummary booking={booking} departed={departed} onUndo={async () => setError(await setBooked(null))} />}
      {departed ? (
        <p className="mt-4 text-[13px] text-ash">This trip has departed, so its alerts are off.</p>
      ) : booking ? (
        <div className="mt-4 border-t border-hairline pt-4 text-[13px] text-body">
          <Toggle checked={trip.alertDrop} onChange={(v) => update({ alertDrop: v })} label="Email me if this fare drops below what I paid" />
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-hairline pt-4 text-[13px] text-body">
          <Toggle checked={trip.alertDrop} onChange={(v) => update({ alertDrop: v })} label="Email me when it drops" />
          <label className="inline-flex items-center gap-2">
            Under $
            <input inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} onBlur={saveTarget} onKeyDown={(e) => e.key === "Enter" && saveTarget()} placeholder="target" className={`${inputClass} w-24`} aria-label="Target price in dollars" />
            {trip.targetHit && <span className="text-xs text-ash">sent</span>}
          </label>
          <label className="inline-flex items-center gap-2">
            Remind me on
            <input type="date" value={trip.remindOn ?? ""} min={new Date().toISOString().slice(0, 10)} max={trip.firstDepart} onChange={(e) => update({ remindOn: e.target.value || null })} className={inputClass} aria-label="Reminder date" />
            {trip.reminded && <span className="text-xs text-ash">sent</span>}
          </label>
        </div>
      )}
      {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
          {open ? "Hide shortlist" : "Show shortlist"}
        </Button>
        <button type="button" onClick={del} aria-label={`Delete ${trip.title}`} className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-mute hover:text-danger">
          <Trash2 size={14} /> Delete
        </button>
      </div>
      {open && board && (
        <div className="mt-6 border-t border-hairline pt-6">
          <p className="mb-4 text-xs text-ash">Prices as of when you saved it. Check a fare before booking.</p>
          <BoardView board={board} latest={false} onFollowup={() => {}} onBook={booking || departed ? undefined : startBooking} {...shared} />
        </div>
      )}
      {marking && <MarkBookedDialog booking={marking} onCancel={() => setMarking(null)} onSave={setBooked} />}
    </article>
  );
}

function BookedSummary({ booking, departed, onUndo }: { booking: Booking; departed: boolean; onUndo: () => void }) {
  return (
    <div className="mt-4 border-t border-hairline pt-4 text-[13px] leading-relaxed">
      <p className="text-ink">
        Booked {booking.fare ? `${booking.fare} ` : ""}with {booking.seller} for {money(booking.paid)}.{" "}
        <button type="button" onClick={onUndo} className="cursor-pointer text-mute hover:text-ink hover:underline">
          Undo
        </button>
      </p>
      {!departed && <p className="mt-1 text-body">{creditVerdict(booking).text}</p>}
    </div>
  );
}

function MarkBookedDialog({ booking, onCancel, onSave }: { booking: Booking; onCancel: () => void; onSave: (b: Booking) => Promise<string | null> }) {
  const [paid, setPaid] = useState(String(booking.paid));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const value = Number(paid.replace(/[$,\s]/g, ""));
    if (!(value > 0)) return setError("Enter what you paid in dollars, like 1500.");
    setBusy(true);
    setError(await onSave({ ...booking, paid: value }));
    setBusy(false);
  };
  return (
    <Dialog
      open
      onClose={onCancel}
      title="Mark as booked"
      width={440}
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Watch this fare"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 p-5 text-[14px] leading-relaxed text-body">
        <p>
          <span className="text-ink">{booking.fare ?? "This fare"}</span> with <span className="text-ink">{booking.seller}</span>. Lodestar will check this exact fare every day and email you if it drops below what you paid.
        </p>
        <label className="flex items-center gap-2 text-[13px]">
          You paid $
          <input inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} className={`${inputClass} w-28`} aria-label="Price you paid in dollars" autoFocus />
        </label>
        <p className="text-[13px] text-mute">{creditVerdict(booking).text}</p>
        {error && <p className="text-[13px] text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}
