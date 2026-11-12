import { Plus, Trash2, Wallet } from "lucide-react";
import { useState } from "react";
import { api, post } from "@/lib/client";
import { budget, CATEGORY_OF } from "@/lib/journeys/plan";
import { COST_CATEGORIES, type Cost, type CostCategory, type TripDetail } from "@/lib/journeys/types";
import { inputClass } from "../dialog";
import { Button } from "../ui";
import { AiButton, AiStatus, EmptyState, TabHead, type Generator } from "./ai-draft";
import { amount, errorText } from "./shared";

// What the trip costs: paid (bookings and costs marked paid) and estimated
// (plans not booked yet and expected extras), by category and per person.

const CATEGORY_LABEL: Record<CostCategory, string> = { flights: "Flights", stays: "Stays", transport: "Getting around", dining: "Food and drink", activities: "Activities", other: "Other" };

function AddCost({ journeyId, currency, onAdded }: { journeyId: string; currency: string; onAdded: (c: Cost) => void }) {
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [category, setCategory] = useState<CostCategory>("other");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    const n = Number(value);
    if (!label.trim() || !Number.isFinite(n) || n < 0) return setError("Give it a name and an amount.");
    setBusy(true);
    setError(null);
    try {
      const { cost } = await post<{ cost: Cost }>(`/api/journeys/${journeyId}/costs`, { label: label.trim(), amount: n, currency, category, paid: false });
      onAdded(cost);
      setLabel("");
      setValue("");
    } catch (err) {
      setError(errorText(err, "Couldn't add it."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_120px_auto]">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Gas, tips, resort fee" aria-label="What it's for" maxLength={120} className={inputClass} />
        <select value={category} onChange={(e) => setCategory(e.target.value as CostCategory)} aria-label="Category" className={`${inputClass} cursor-pointer`}>
          {COST_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder={`Amount (${currency})`} aria-label="Amount" className={`${inputClass} tnum`} />
        <Button type="submit" variant="ghost" disabled={busy} className="max-sm:!h-12 sm:!h-auto">
          <Plus size={14} /> Add
        </Button>
      </div>
      {error && <p className="text-[12px] text-danger">{error}</p>}
    </form>
  );
}

export function BudgetTab({ trip, gen, onOpenItem, onCosts }: { trip: TripDetail; gen: Generator; onOpenItem: (id: string) => void; onCosts: (update: (c: Cost[]) => Cost[]) => void }) {
  const [error, setError] = useState<string | null>(null);
  const b = budget(trip);
  const priced = trip.items.filter((i) => i.status !== "cancelled" && i.status !== "suggested" && (i.details.price !== undefined || i.details.estimate !== undefined));

  const patch = async (c: Cost, body: Partial<Cost>) => {
    onCosts((cs) => cs.map((x) => (x.id === c.id ? { ...x, ...body } : x)));
    try {
      const { cost } = await api<{ cost: Cost }>(`/api/journeys/costs/${c.id}`, { method: "PATCH", body: JSON.stringify(body) });
      onCosts((cs) => cs.map((x) => (x.id === c.id ? cost : x)));
    } catch (err) {
      onCosts((cs) => cs.map((x) => (x.id === c.id ? c : x)));
      setError(errorText(err, "Couldn't update it."));
    }
  };
  const remove = async (c: Cost) => {
    try {
      await api(`/api/journeys/costs/${c.id}`, { method: "DELETE" });
      onCosts((cs) => cs.filter((x) => x.id !== c.id));
    } catch (err) {
      setError(errorText(err, "Couldn't remove it."));
    }
  };

  return (
    <div className="space-y-8">
      <TabHead title="Budget" sub={b.total ? `Paid, plus estimates for the rest${b.otherCurrencies.length ? `. Amounts in ${b.otherCurrencies.join(", ")} aren't counted.` : "."}` : undefined}>
        {b.total > 0 && <AiButton gen={gen} part="budget" label="Re-estimate" />}
      </TabHead>
      <AiStatus gen={gen} parts={["budget"]} />
      {error && <p className="text-[13px] text-danger">{error}</p>}

      {b.total === 0 ? (
        <EmptyState icon={<Wallet size={18} />} title="No costs yet" body="Prices from your bookings add up here on their own. Your AI can estimate the rest: meals, activities, gas, fees.">
          <AiButton gen={gen} part="budget" variant="primary" />
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border border-hairline-strong bg-card">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-hairline text-left text-[12px] text-mute">
                <th className="px-4 py-3 font-normal">Category</th>
                <th className="px-4 py-3 text-right font-normal">Paid</th>
                <th className="px-4 py-3 text-right font-normal">Estimated</th>
                <th className="px-4 py-3 text-right font-normal max-sm:hidden">Total</th>
              </tr>
            </thead>
            <tbody className="tnum divide-y divide-hairline">
              {b.lines.map((l) => (
                <tr key={l.category}>
                  <td className="px-4 py-3 text-ink">{CATEGORY_LABEL[l.category]}</td>
                  <td className="px-4 py-3 text-right text-body">{l.paid ? amount(l.paid, b.currency) : "—"}</td>
                  <td className="px-4 py-3 text-right text-mute">{l.estimated ? `~${amount(l.estimated, b.currency)}` : "—"}</td>
                  <td className="px-4 py-3 text-right text-ink max-sm:hidden">{amount(l.paid + l.estimated, b.currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="tnum border-t border-hairline-strong">
              <tr>
                <td className="px-4 py-4 font-medium text-ink">All in</td>
                <td className="px-4 py-4 text-right text-body">{amount(b.paid, b.currency)}</td>
                <td className="px-4 py-4 text-right text-mute">~{amount(b.estimated, b.currency)}</td>
                <td className="px-4 py-4 text-right text-[16px] font-medium text-ink max-sm:hidden">{amount(b.total, b.currency)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="tnum border-t border-hairline px-4 py-3 text-[13px] text-mute">
            <span className="sm:hidden">{amount(b.total, b.currency)} all in. </span>
            {b.perPerson ? `About ${amount(b.perPerson, b.currency)} per person for ${trip.travelers} travellers.` : "Set how many are going in Edit to see a per-person figure."}
          </p>
        </div>
      )}

      <section aria-labelledby="extras-head" className="space-y-3">
        <div>
          <h3 id="extras-head" className="text-[15px] font-medium text-ink">
            Other costs
          </h3>
          <p className="mt-1 text-[13px] text-mute">Things that aren&apos;t a booking. Tick paid once they are.</p>
        </div>
        {trip.costs.length > 0 && (
          <ul className="divide-y divide-hairline rounded-xl border border-hairline-strong bg-card">
            {trip.costs.map((c) => (
              <li key={c.id} className="group flex items-center gap-3 px-4 py-3">
                <label className="-mx-2.5 inline-grid size-9 shrink-0 cursor-pointer place-items-center pointer-coarse:-mx-3.5 pointer-coarse:size-11">
                  <input type="checkbox" checked={c.paid} onChange={(e) => patch(c, { paid: e.target.checked })} aria-label={`${c.label} paid`} className="size-4 cursor-pointer accent-[var(--accent)]" />
                </label>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-ink">{c.label}</span>
                  <span className="block text-[12px] text-ash">
                    {CATEGORY_LABEL[c.category]}
                    {c.source === "ai" ? " · AI estimate" : c.source === "agent" ? " · added by an agent" : ""}
                  </span>
                </span>
                <span className={`tnum shrink-0 text-[14px] ${c.paid ? "text-body" : "text-mute"}`}>{c.paid ? "" : "~"}{amount(c.amount, c.currency)}</span>
                <button type="button" onClick={() => remove(c)} aria-label={`Remove ${c.label}`} className="inline-flex size-9 pointer-coarse:size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-ash hover:text-danger">
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <AddCost journeyId={trip.id} currency={b.currency} onAdded={(c) => onCosts((cs) => [...cs, c])} />
      </section>

      {priced.length > 0 && (
        <section aria-labelledby="from-plan-head" className="space-y-3">
          <h3 id="from-plan-head" className="text-[15px] font-medium text-ink">
            From your plan
          </h3>
          <ul className="divide-y divide-hairline rounded-xl border border-hairline-strong bg-card">
            {priced.map((i) => {
              const paid = i.status === "booked" && i.details.price !== undefined;
              const value = paid ? i.details.price! : (i.details.estimate ?? i.details.price!);
              return (
                <li key={i.id}>
                  <button type="button" onClick={() => onOpenItem(i.id)} className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left hover:bg-hover">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] text-ink">{i.title}</span>
                      <span className="block text-[12px] text-ash">
                        {CATEGORY_LABEL[CATEGORY_OF[i.kind]]} · {paid ? "paid" : "estimate"}
                      </span>
                    </span>
                    <span className={`tnum shrink-0 text-[14px] ${paid ? "text-body" : "text-mute"}`}>
                      {paid ? "" : "~"}
                      {amount(value, i.details.currency)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
