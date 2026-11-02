import { useState } from "react";
import { CUISINE_CHOICES, DIETARY_CHOICES, HOTEL_PRIORITY_CHOICES, INTEREST_CHOICES, PACES, PRICE_LEVELS, type Preferences } from "@/lib/preferences";
import { Field, inputClass } from "./dialog";

// On-the-ground preferences (food, things to do, hotels). Trips uses them for
// dining plans and hotel picks. Shared by onboarding and Travel preferences.

type Set = <K extends keyof Preferences>(k: K, v: Preferences[K]) => void;

const chip = (on: boolean) =>
  `h-9 cursor-pointer rounded-full border px-3.5 text-[13px] max-sm:h-10 ${on ? "border-hairline-hover bg-elevated text-ink" : "border-hairline-strong text-mute hover:text-charcoal"}`;

/** Toggle chips for a list preference, plus a box for anything not offered. */
export function Chips({ label, choices, value, onChange, max }: { label: string; choices: string[]; value: string[]; onChange: (v: string[]) => void; max: number }) {
  const [other, setOther] = useState("");
  const extra = value.filter((v) => !choices.includes(v));
  const toggle = (c: string) => onChange(value.includes(c) ? value.filter((x) => x !== c) : value.length < max ? [...value, c] : value);
  const add = () => {
    const v = other.trim().replace(/[^\p{L}\p{N}\s&'’,.()/-]/gu, "").slice(0, 40);
    if (v && !value.includes(v) && value.length < max) onChange([...value, v]);
    setOther("");
  };
  return (
    <fieldset>
      <legend className="mb-2 text-[12px] text-charcoal">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {[...choices, ...extra].map((c) => (
          <button key={c} type="button" aria-pressed={value.includes(c)} onClick={() => toggle(c)} className={chip(value.includes(c))}>
            {c}
          </button>
        ))}
        <input
          value={other}
          onChange={(e) => setOther(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder="Other…"
          aria-label={`Add to ${label.toLowerCase()}`}
          className="h-9 w-28 rounded-full border border-dashed border-hairline-strong bg-transparent px-3.5 text-[13px] text-ink outline-none placeholder:text-stone focus:border-accent max-sm:h-10"
        />
      </div>
    </fieldset>
  );
}

export function DiningFields({ p, set }: { p: Preferences; set: Set }) {
  return (
    <div className="space-y-5">
      <Chips label="Food you love" choices={CUISINE_CHOICES} value={p.cuisines} onChange={(v) => set("cuisines", v)} max={12} />
      <Chips label="Dietary needs" choices={DIETARY_CHOICES} value={p.dietary} onChange={(v) => set("dietary", v)} max={8} />
      <fieldset>
        <legend className="mb-2 text-[12px] text-charcoal">Usual dinner budget</legend>
        <div className="flex flex-wrap gap-2">
          {PRICE_LEVELS.map((level) => (
            <button key={level} type="button" aria-pressed={p.diningBudget === level} onClick={() => set("diningBudget", p.diningBudget === level ? null : level)} className={`${chip(p.diningBudget === level)} font-mono`}>
              {level}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

const PACE_LABEL: Record<(typeof PACES)[number], string> = { relaxed: "Relaxed", balanced: "Balanced", packed: "See everything" };

export function DoingFields({ p, set }: { p: Preferences; set: Set }) {
  const [budget, setBudget] = useState(p.hotelBudget?.toString() ?? "");
  return (
    <div className="space-y-5">
      <Chips label="What you like doing" choices={INTEREST_CHOICES} value={p.interests} onChange={(v) => set("interests", v)} max={12} />
      <fieldset>
        <legend className="mb-2 text-[12px] text-charcoal">Pace</legend>
        <div className="flex flex-wrap gap-2">
          {PACES.map((pace) => (
            <button key={pace} type="button" aria-pressed={p.pace === pace} onClick={() => set("pace", pace)} className={chip(p.pace === pace)}>
              {PACE_LABEL[pace]}
            </button>
          ))}
        </div>
      </fieldset>
      <Chips label="In a hotel you care about" choices={HOTEL_PRIORITY_CHOICES} value={p.hotelPriorities} onChange={(v) => set("hotelPriorities", v)} max={8} />
      <Field label="Hotel budget per night (USD, optional)">
        <input
          inputMode="numeric"
          value={budget}
          onChange={(e) => setBudget(e.target.value.replace(/[^\d]/g, "").slice(0, 4))}
          onBlur={() => {
            const n = Number(budget);
            set("hotelBudget", budget && n >= 20 ? n : null);
            if (budget && n < 20) setBudget("");
          }}
          placeholder="250"
          className={`${inputClass} max-w-40`}
        />
      </Field>
    </div>
  );
}
