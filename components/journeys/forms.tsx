import { useState } from "react";
import { api, post } from "@/lib/client";
import type { Journey, Kind, TripType } from "@/lib/journeys/types";
import { Dialog, Field, inputClass } from "../dialog";
import { Button, Toggle } from "../ui";
import { DateField, DateRangeField } from "./date-field";
import { TravellersField, TripTypeField } from "./quick-start";
import { errorText } from "./shared";

// Small forms: start or edit a trip, add something to one.

/** Edits a trip's name, place, dates, who's going and what kind of trip it is. */
export function JourneyDialog({ open, onClose, journey, onSaved }: { open: boolean; onClose: () => void; journey: Journey; onSaved: (id: string) => void }) {
  const [destination, setDestination] = useState(journey.destination ?? "");
  const [travelers, setTravelers] = useState<number | null>(journey.travelers);
  const [type, setType] = useState<TripType | null>(journey.tripType);
  const [title, setTitle] = useState(journey.title);
  const [start, setStart] = useState(journey.startDate ?? "");
  const [end, setEnd] = useState(journey.endDate ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/journeys/${journey.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: title.trim() || journey.title, destination: destination.trim() || null, startDate: start || null, endDate: end || start || null, travelers, tripType: type }),
      });
      onSaved(journey.id);
    } catch (err) {
      setError(errorText(err, "Couldn't save the trip."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Edit trip"
      footer={
        <div className="flex items-center justify-end gap-2">
          {error && <p className="mr-auto text-[13px] text-danger">{error}</p>}
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || !destination.trim()} onClick={save}>
            Save
          </Button>
        </div>
      }
    >
      <form
        className="space-y-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (destination.trim()) save();
        }}
      >
        <Field label="Where to">
          <input autoFocus value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Lisbon" className={inputClass} maxLength={80} />
        </Field>
        <div>
          <span className="mb-1.5 block text-[12px] text-charcoal">Dates</span>
          <DateRangeField
            inline
            label="Trip dates"
            start={start || null}
            end={end || null}
            onChange={(a, b) => {
              setStart(a ?? "");
              setEnd(b ?? "");
            }}
          />
        </div>
        <Field label="Name">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={destination ? `${destination} trip` : "Name"} className={inputClass} maxLength={160} />
        </Field>
        <div>
          <span className="mb-1.5 block text-[12px] text-charcoal">Who&apos;s going</span>
          <TravellersField value={travelers} onChange={setTravelers} />
        </div>
        <div>
          <span className="mb-1.5 block text-[12px] text-charcoal">What kind of trip</span>
          <TripTypeField value={type} onChange={setType} />
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

const KIND_LABEL: Record<Exclude<Kind, "note">, string> = { activity: "Something to do", dining: "Restaurant", stay: "Place to stay", flight: "Flight", transport: "Train, car or transfer" };

/** `preset` starts it on a kind (and a name, like "Rental car"). */
export function AddItemDialog({ open, onClose, journey, onAdded, preset }: { open: boolean; onClose: () => void; journey: Journey; onAdded: () => void; preset?: { kind: Exclude<Kind, "note">; title?: string } }) {
  const [kind, setKind] = useState<Exclude<Kind, "note">>(preset?.kind ?? "activity");
  const [title, setTitle] = useState(preset?.title ?? "");
  const [date, setDate] = useState(journey.startDate ?? "");
  const [time, setTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [place, setPlace] = useState(journey.destination ?? "");
  const [confirmation, setConfirmation] = useState("");
  const [booked, setBooked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await post(`/api/journeys/${journey.id}/items`, {
        kind,
        status: booked || confirmation.trim() ? "booked" : "planned",
        title,
        startDate: date,
        startTime: time || null,
        endDate: endDate || null,
        place: place.trim() || null,
        confirmation: confirmation.trim() || null,
      });
      onAdded();
    } catch (err) {
      setError(errorText(err, "Couldn't add it."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add to trip"
      footer={
        <div className="flex items-center justify-end gap-2">
          {error && <p className="mr-auto text-[13px] text-danger">{error}</p>}
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || !title.trim() || !date} onClick={add}>
            Add
          </Button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="What is it">
          {(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={`h-9 cursor-pointer rounded-full border px-3.5 text-[13px] ${kind === k ? "border-hairline-hover bg-elevated text-ink" : "border-hairline-strong text-mute hover:text-charcoal"}`}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <Field label={kind === "flight" ? "Flight" : "Name"}>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "flight" ? "UA 837 · SFO → NRT" : kind === "dining" ? "Cervejaria Ramiro" : kind === "stay" ? "Memmo Alfama" : "Tile museum"} className={inputClass} maxLength={160} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {kind === "stay" ? (
            <div className="sm:col-span-2">
              <span className="mb-1.5 block text-[12px] text-charcoal">Check-in and check-out</span>
              <DateRangeField
                inline
                label="Check-in and check-out"
                start={date || null}
                end={endDate || null}
                onChange={(a, b) => {
                  setDate(a ?? "");
                  setEndDate(b ?? "");
                }}
              />
            </div>
          ) : (
            <div className="sm:col-span-2">
              <span className="mb-1.5 block text-[12px] text-charcoal">Date</span>
              <DateField inline label="Date" value={date || null} onChange={setDate} />
            </div>
          )}
          {kind !== "stay" && (
            <Field label="Time (optional)">
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputClass} />
            </Field>
          )}
          <Field label="Confirmation (optional)">
            <input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className={`${inputClass} font-mono`} maxLength={40} />
          </Field>
        </div>
        <Field label="Where">
          <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="City or address" className={inputClass} maxLength={160} />
        </Field>
        <Toggle checked={booked || Boolean(confirmation.trim())} onChange={setBooked} label="Already booked" />
      </div>
    </Dialog>
  );
}
