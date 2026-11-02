import { useState, type ReactNode } from "react";
import { ALLIANCES, ALLIANCE_LABEL, type Preferences } from "@/lib/preferences";
import type { Cabin, MaxStops } from "@/lib/types";
import { AirportField } from "./airport-field";
import { Dialog, Field } from "./dialog";
import { CABIN_LABEL, STOP_LABEL, selectClass } from "./preferences-dialog";
import { Button, Toggle } from "./ui";

// First run after sign-up: one or two questions per page, every page
// skippable, preferences saved before the last page, which offers to connect
// ChatGPT or Grok for Plan.

type Page = { title: string; hint: string; body: (p: Preferences, set: <K extends keyof Preferences>(k: K, v: Preferences[K]) => void) => ReactNode };

const PAGES: Page[] = [
  {
    title: "Where do you usually fly from?",
    hint: "Your home airports fill in new searches, and Plan uses them when you don't say where you're leaving from.",
    body: (p, set) => <AirportField bare label="Home airports" value={p.homeAirports} onChange={(v) => set("homeAirports", v)} placeholder="City or airport" />,
  },
  {
    title: "Do you stick to an alliance?",
    hint: "Handy if you collect miles or have status. Leave it blank to see every airline.",
    body: (p, set) => (
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          {ALLIANCES.map((a) => {
            const on = p.alliances.includes(a);
            return (
              <button
                key={a}
                type="button"
                aria-pressed={on}
                onClick={() => set("alliances", on ? p.alliances.filter((x) => x !== a) : [...p.alliances, a])}
                className={`h-10 cursor-pointer rounded-full border px-4 text-[14px] ${on ? "border-hairline-hover bg-elevated text-ink" : "border-hairline-strong text-mute hover:text-charcoal"}`}
              >
                {ALLIANCE_LABEL[a]}
              </button>
            );
          })}
        </div>
        <AirportField bare kind="airline" max={10} label="Airlines to rank higher (optional)" value={p.preferredAirlines} onChange={(v) => set("preferredAirlines", v)} placeholder="Airline name or code" />
      </div>
    ),
  },
  {
    title: "Any airlines you'd rather skip?",
    hint: "They won't show up in search results or in Plan.",
    body: (p, set) => <AirportField bare kind="airline" max={20} label="Never show these airlines" value={p.avoidedAirlines} onChange={(v) => set("avoidedAirlines", v)} placeholder="Airline name or code" />,
  },
  {
    title: "How do you usually travel?",
    hint: "The defaults for new searches. You can change them on any search.",
    body: (p, set) => (
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Cabin">
          <select className={selectClass} value={p.cabin} onChange={(e) => set("cabin", e.target.value as Cabin)}>
            {(Object.keys(CABIN_LABEL) as Cabin[]).map((c) => (
              <option key={c} value={c}>
                {CABIN_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Travellers">
          <select className={selectClass} value={p.adults} onChange={(e) => set("adults", Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n} adult{n > 1 ? "s" : ""}
              </option>
            ))}
          </select>
        </Field>
      </div>
    ),
  },
  {
    title: "Bags and stops?",
    hint: "Prices include checked bags when you add them, so the cheapest fare is the real cheapest.",
    body: (p, set) => (
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Checked bags">
          <select className={selectClass} value={p.bags} onChange={(e) => set("bags", Number(e.target.value))}>
            <option value={0}>None</option>
            <option value={1}>1 checked bag</option>
            <option value={2}>2 checked bags</option>
          </select>
        </Field>
        <Field label="Stops">
          <select className={selectClass} value={p.stops} onChange={(e) => set("stops", e.target.value as MaxStops)}>
            {(Object.keys(STOP_LABEL) as MaxStops[]).map((s) => (
              <option key={s} value={s}>
                {STOP_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
      </div>
    ),
  },
  {
    title: "Anything you won't fly?",
    hint: "Turn these on to hide those flights everywhere.",
    body: (p, set) => (
      <div className="flex flex-wrap gap-2">
        <Toggle checked={p.avoidRedEyes} onChange={(v) => set("avoidRedEyes", v)} label="Red-eyes" />
        <Toggle checked={p.noBasicEconomy} onChange={(v) => set("noBasicEconomy", v)} label="Basic economy" />
      </div>
    ),
  },
];

export function Onboarding({
  open,
  initial,
  aiConnected,
  onSave,
  onConnectAi,
  onDone,
}: {
  open: boolean;
  initial: Preferences;
  aiConnected: boolean;
  /** Saves the answers. Resolves with an error message or null. */
  onSave: (prefs: Preferences) => Promise<string | null>;
  onConnectAi: () => void;
  onDone: () => void;
}) {
  const [p, setP] = useState<Preferences>(initial);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Preferences>(k: K, v: Preferences[K]) => setP((cur) => ({ ...cur, [k]: v }));
  const total = PAGES.length + 1;
  const page = PAGES[step];
  const onAiPage = step === PAGES.length;

  const next = async () => {
    setError(null);
    if (step < PAGES.length - 1) return setStep(step + 1);
    // Leaving the last question: save, so closing on the AI page keeps the answers.
    setBusy(true);
    const problem = await onSave(p);
    setBusy(false);
    if (problem) return setError(problem);
    setStep(PAGES.length);
  };

  return (
    <Dialog
      open={open}
      onClose={onDone}
      title="Set up Lodestar"
      width={520}
      footer={
        <div className="space-y-2">
          {error && <p className="text-[13px] text-danger">{error}</p>}
          <div className="flex items-center gap-2">
            {step > 0 && (
              <Button variant="ghost" onClick={() => setStep(step - 1)}>
                Back
              </Button>
            )}
            {onAiPage ? (
              <>
                <Button variant="ghost" className="ml-auto" onClick={onDone}>
                  {aiConnected ? "Continue" : "Maybe later"}
                </Button>
                {!aiConnected && (
                  <Button variant="primary" onClick={onConnectAi}>
                    Connect ChatGPT or Grok
                  </Button>
                )}
              </>
            ) : (
              <>
                <button type="button" onClick={() => (step < PAGES.length - 1 ? setStep(step + 1) : next())} className="ml-auto cursor-pointer px-2 text-[13px] text-mute hover:text-ink">
                  Skip
                </button>
                <Button variant="primary" disabled={busy} onClick={next}>
                  {busy ? "Saving…" : "Next"}
                </Button>
              </>
            )}
          </div>
        </div>
      }
    >
      <div className="p-5">
        <div className="flex gap-1" aria-label={`Step ${step + 1} of ${total}`}>
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={`h-1 flex-1 rounded-full transition-colors duration-200 ${i <= step ? "bg-accent" : "bg-hairline-strong"}`} />
          ))}
        </div>
        <div key={step} className="rise min-h-[220px] pt-6">
          {onAiPage ? (
            <>
              <h3 className="text-[22px] leading-snug text-ink">{aiConnected ? "Plan is ready to go." : "Last step: connect your AI."}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-mute">
                {aiConnected
                  ? "Your AI account is connected. Next, a quick look at how Plan works."
                  : "Plan turns a sentence like “Chennai over the holidays, nonstop if it's close” into several live searches and a shortlist. It runs on your own ChatGPT or Grok subscription, and the connection is saved to your account."}
              </p>
            </>
          ) : (
            <>
              <h3 className="text-[22px] leading-snug text-ink">{page.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-mute">{page.hint}</p>
              <div className="mt-6">{page.body(p, set)}</div>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
