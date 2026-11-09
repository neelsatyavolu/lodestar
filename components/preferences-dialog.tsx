import { useState } from "react";
import { ALLIANCES, ALLIANCE_LABEL, type Preferences } from "@/lib/preferences";
import type { Cabin, MaxStops } from "@/lib/types";
import { AirportField } from "./airport-field";
import { Dialog, Field } from "./dialog";
import { DiningFields, DoingFields } from "./tastes";
import { Button, Toggle } from "./ui";

export const CABIN_LABEL: Record<Cabin, string> = { ECONOMY: "Economy", PREMIUM_ECONOMY: "Premium economy", BUSINESS: "Business", FIRST: "First" };
export const STOP_LABEL: Record<MaxStops, string> = { ANY: "Any", "0": "Nonstop only", "1": "1 stop or fewer", "2": "2 stops or fewer" };

export const selectClass = "h-10 w-full cursor-pointer rounded-md border border-hairline-hover bg-card px-3 text-[14px] text-ink outline-none max-sm:h-12";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-t border-hairline pt-5 first:border-t-0 first:pt-0">
      <h3 className="text-[13px] font-medium text-ink">{title}</h3>
      {children}
    </section>
  );
}

export function PreferencesDialog({
  open,
  onClose,
  value,
  signedIn,
  email,
  onSave,
  onCreateAccount,
  onSignOut,
}: {
  open: boolean;
  onClose: () => void;
  value: Preferences;
  signedIn: boolean;
  email: string | null;
  /** Applies the preferences now; saves them when signed in. Resolves with an error message or null. */
  onSave: (prefs: Preferences) => Promise<string | null>;
  onCreateAccount: (prefs: Preferences) => void;
  onSignOut: () => void;
}) {
  const [p, setP] = useState<Preferences>(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Preferences>(k: K, v: Preferences[K]) => setP((cur) => ({ ...cur, [k]: v }));

  const save = async () => {
    setBusy(true);
    setError(null);
    const problem = await onSave(p);
    setBusy(false);
    if (problem) setError(problem);
    else onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Travel preferences"
      width={600}
      footer={
        <div className="space-y-2">
          {error && <p className="text-[13px] text-danger">{error}</p>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!signedIn && <span className="mr-auto text-xs text-ash">These apply now. Create an account to keep them.</span>}
            {signedIn && email && <span className="mr-auto truncate text-xs text-ash">Signed in as {email}</span>}
            {signedIn && (
              <Button
                variant="ghost"
                onClick={() => {
                  onSignOut();
                  onClose();
                }}
              >
                Sign out
              </Button>
            )}
            {!signedIn && (
              <Button
                variant="ghost"
                onClick={() => {
                  onCreateAccount(p);
                  onClose();
                }}
              >
                Create account
              </Button>
            )}
            <Button variant="primary" disabled={busy} onClick={save}>
              {busy ? "Saving…" : signedIn ? "Save preferences" : "Use for now"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5 p-5">
        <Section title="Where you fly from">
          <AirportField bare label="Home airports (filled in for new searches)" value={p.homeAirports} onChange={(v) => set("homeAirports", v)} placeholder="City or airport" />
        </Section>

        <Section title="Airlines">
          <div>
            <span className="mb-1.5 block text-[12px] text-charcoal">Alliances (only show these)</span>
            <div className="flex flex-wrap gap-2">
              {ALLIANCES.map((a) => {
                const on = p.alliances.includes(a);
                return (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set("alliances", on ? p.alliances.filter((x) => x !== a) : [...p.alliances, a])}
                    className={`h-9 cursor-pointer rounded-full border px-3.5 text-[13px] max-sm:h-10 ${on ? "border-hairline-hover bg-elevated text-ink" : "border-hairline-strong text-mute hover:text-charcoal"}`}
                  >
                    {ALLIANCE_LABEL[a]}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[12px] text-ash">Leave all off to see every airline. Google also includes close partners of an alliance.</p>
          </div>
          <AirportField bare kind="airline" max={10} label="Prefer these airlines (ranked higher, e.g. where you have status)" value={p.preferredAirlines} onChange={(v) => set("preferredAirlines", v)} placeholder="Airline name or code" />
          <AirportField bare kind="airline" max={20} label="Never show these airlines" value={p.avoidedAirlines} onChange={(v) => set("avoidedAirlines", v)} placeholder="Airline name or code" />
        </Section>

        <Section title="Trip defaults">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Cabin">
              <select className={selectClass} value={p.cabin} onChange={(e) => set("cabin", e.target.value as Cabin)}>
                {(Object.keys(CABIN_LABEL) as Cabin[]).map((c) => (
                  <option key={c} value={c}>
                    {CABIN_LABEL[c]}
                  </option>
                ))}
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
            <Field label="Travellers">
              <select className={selectClass} value={p.adults} onChange={(e) => set("adults", Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n} adult{n > 1 ? "s" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Checked bags">
              <select className={selectClass} value={p.bags} onChange={(e) => set("bags", Number(e.target.value))}>
                <option value={0}>None</option>
                <option value={1}>1 checked bag</option>
                <option value={2}>2 checked bags</option>
              </select>
            </Field>
          </div>
        </Section>

        <Section title="Comfort and sellers">
          <div className="flex flex-wrap gap-2">
            <Toggle checked={p.avoidRedEyes} onChange={(v) => set("avoidRedEyes", v)} label="Avoid red-eyes" />
            <Toggle checked={p.avoidSelfTransfer} onChange={(v) => set("avoidSelfTransfer", v)} label="Avoid self-transfers" />
            <Toggle checked={p.noBasicEconomy} onChange={(v) => set("noBasicEconomy", v)} label="No basic economy" />
            <Toggle checked={p.trustedOnly} onChange={(v) => set("trustedOnly", v)} label="Trusted sellers only" />
          </div>
        </Section>

        <Section title="Hacks to run on every search">
          <div className="flex flex-wrap gap-2">
            <Toggle checked={p.nearby} onChange={(v) => set("nearby", v)} label="Nearby airports" />
            <Toggle checked={p.flexible} onChange={(v) => set("flexible", v)} label="±3 days" />
            <Toggle checked={p.split} onChange={(v) => set("split", v)} label="Two one-ways" />
          </div>
        </Section>

        <Section title="Food, for Trips' dining plans">
          <DiningFields p={p} set={set} />
        </Section>

        <Section title="Things to do and hotels">
          <DoingFields p={p} set={set} />
        </Section>

      </div>
    </Dialog>
  );
}
