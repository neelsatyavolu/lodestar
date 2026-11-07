import { Minus, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import { post } from "@/lib/client";
import { TRIP_TYPES, type TripType } from "@/lib/journeys/types";
import { PROVIDER_NAME, type Provider } from "../connect-ai";
import { Dialog, Field, inputClass } from "../dialog";
import { Button, Toggle } from "../ui";
import { DateRangeField } from "./date-field";
import { errorText, TRIP_TYPE_LABEL } from "./shared";

// A new trip in four answers: where, when, who, what kind. With an AI
// connected it then drafts the whole plan, one part at a time.

export function TravellersField({ value, onChange }: { value: number | null; onChange: (n: number | null) => void }) {
  const n = value ?? 1;
  const step = "inline-flex size-10 cursor-pointer items-center justify-center rounded-md border border-hairline-strong bg-deep text-charcoal hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="flex items-center gap-3" role="group" aria-label="Travellers">
      <button type="button" className={step} aria-label="One fewer" disabled={n <= 1} onClick={() => onChange(Math.max(1, n - 1))}>
        <Minus size={14} />
      </button>
      <span className="tnum min-w-20 text-center text-[14px] text-ink" aria-live="polite">
        {n} {n === 1 ? "traveller" : "travellers"}
      </span>
      <button type="button" className={step} aria-label="One more" disabled={n >= 30} onClick={() => onChange(Math.min(30, n + 1))}>
        <Plus size={14} />
      </button>
    </div>
  );
}

export function TripTypeField({ value, onChange }: { value: TripType | null; onChange: (t: TripType | null) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Kind of trip">
      {TRIP_TYPES.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={value === t}
          onClick={() => onChange(value === t ? null : t)}
          className={`h-9 cursor-pointer rounded-full border px-3.5 text-[13px] transition-colors duration-150 ${value === t ? "border-accent bg-tint text-ink" : "border-hairline-strong text-mute hover:text-charcoal"}`}
        >
          {TRIP_TYPE_LABEL[t]}
        </button>
      ))}
    </div>
  );
}

export type DraftRequest = { wishes: string };

type Props = { open: boolean; onClose: () => void; provider: Provider | null; onConnectAi: () => void; onCreated: (id: string, draft: DraftRequest | null) => void };

export function NewTripDialog({ open, onClose, provider, onConnectAi, onCreated }: Props) {
  const [destination, setDestination] = useState("");
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [travelers, setTravelers] = useState<number | null>(2);
  const [type, setType] = useState<TripType | null>(null);
  const [wishes, setWishes] = useState("");
  const [draft, setDraft] = useState(Boolean(provider));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const willDraft = draft && Boolean(provider) && Boolean(start);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { id } = await post<{ id: string }>("/api/journeys", { destination: destination.trim(), startDate: start, endDate: end ?? start, travelers, tripType: type });
      onCreated(id, willDraft ? { wishes } : null);
    } catch (err) {
      setError(errorText(err, "Couldn't start the trip."));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Plan a trip"
      width={560}
      footer={
        <div className="flex items-center justify-end gap-2">
          {error && <p className="mr-auto text-[13px] text-danger">{error}</p>}
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || !destination.trim()} onClick={create}>
            {willDraft ? (
              <>
                <Sparkles size={14} aria-hidden /> Create and draft
              </>
            ) : (
              "Create trip"
            )}
          </Button>
        </div>
      }
    >
      <form
        className="space-y-5 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (destination.trim()) create();
        }}
      >
        <Field label="Where to">
          <input autoFocus value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Lisbon, the Amalfi Coast, Tucson" className={inputClass} maxLength={80} />
        </Field>
        <div>
          <span className="mb-1.5 block text-[12px] text-charcoal">When</span>
          <DateRangeField
            inline
            label="Trip dates"
            start={start}
            end={end}
            onChange={(a, b) => {
              setStart(a);
              setEnd(b);
            }}
          />
        </div>
        <div>
          <span className="mb-1.5 block text-[12px] text-charcoal">Who&apos;s going</span>
          <TravellersField value={travelers} onChange={setTravelers} />
        </div>
        <div>
          <span className="mb-1.5 block text-[12px] text-charcoal">What kind of trip</span>
          <TripTypeField value={type} onChange={setType} />
        </div>
        <div className="space-y-3 rounded-xl border border-hairline-strong bg-deep p-4">
          {provider ? (
            <>
              <Toggle checked={draft} onChange={setDraft} label={`Draft it with ${PROVIDER_NAME[provider]}`} />
              {draft && (
                <>
                  <p className="text-[12px] text-mute">{start ? "Days, what to book, a checklist, notes and a budget, from your saved preferences. About a minute per part; you can keep working." : "Add dates and it can draft the days too."}</p>
                  <Field label="Anything it should know? (optional)">
                    <textarea value={wishes} onChange={(e) => setWishes(e.target.value)} rows={2} maxLength={600} placeholder="Two vegetarians, one rest day, a spa afternoon" className={`${inputClass} h-auto py-2`} />
                  </Field>
                </>
              )}
            </>
          ) : (
            <p className="text-[13px] text-body">
              <button type="button" onClick={onConnectAi} className="cursor-pointer text-accent hover:underline">
                Connect ChatGPT or Grok
              </button>{" "}
              and it can draft the days, what to book, a checklist and a budget for you.
            </p>
          )}
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
