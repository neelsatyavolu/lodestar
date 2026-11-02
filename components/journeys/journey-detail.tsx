import { ArrowLeft, BedDouble, Building2, Pencil, Plus, Trash2, UtensilsCrossed } from "lucide-react";
import { useState } from "react";
import { api, post } from "@/lib/client";
import { day } from "@/lib/format";
import type { Item, JourneyWithItems } from "@/lib/journeys/types";
import type { Provider } from "../connect-ai";
import { Button, Spinner } from "../ui";
import { AddItemDialog, JourneyDialog } from "./forms";
import { ItemRow } from "./item-row";
import { countdown, dateRange, daysOf, errorText, stayOn } from "./shared";

// One trip, day by day: where you sleep, what's booked, what's planned, and
// the AI's ideas drawn apart from all of that.

type Props = {
  journey: JourneyWithItems;
  provider: Provider | null;
  onConnectAi: () => void;
  onBack: () => void;
  /** Applied to the latest copy, so two quick actions never undo each other. */
  onChanged: (update: (j: JourneyWithItems) => JourneyWithItems) => void;
  onDeleted: () => void;
};

const byTime = (a: Item, b: Item) => (a.startTime ?? "").localeCompare(b.startTime ?? "");

export function JourneyDetail({ journey, provider, onConnectAi, onBack, onChanged, onDeleted }: Props) {
  const [suggesting, setSuggesting] = useState<"dining" | "hotels" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"edit" | "add" | null>(null);
  const [formKey, setFormKey] = useState(0);
  const days = daysOf(journey);
  const hasDates = Boolean(journey.startDate);
  const when = countdown(journey);

  const reload = async () => {
    const { journey: next } = await api<{ journey: JourneyWithItems }>(`/api/journeys/${journey.id}`);
    onChanged(() => next);
  };

  const suggest = async (kind: "dining" | "hotels") => {
    if (!provider) return onConnectAi();
    setSuggesting(kind);
    setError(null);
    try {
      const { journey: next } = await post<{ journey: JourneyWithItems }>(`/api/journeys/${journey.id}/suggest`, { provider, kind });
      onChanged(() => next);
    } catch (err) {
      setError(errorText(err, "The suggestions didn't come through. Try again."));
    } finally {
      setSuggesting(null);
    }
  };

  const del = async () => {
    if (!window.confirm(`Delete ${journey.title} and everything in it?`)) return;
    try {
      await api(`/api/journeys/${journey.id}`, { method: "DELETE" });
      onDeleted();
    } catch (err) {
      setError(errorText(err, "Couldn't delete the trip."));
    }
  };

  const replace = (it: Item) => onChanged((j) => ({ ...j, items: j.items.map((x) => (x.id === it.id ? it : x)) }));
  const drop = (id: string) => onChanged((j) => ({ ...j, items: j.items.filter((x) => x.id !== id) }));
  const open = (d: "edit" | "add") => {
    setFormKey((k) => k + 1);
    setDialog(d);
  };
  const hotelIdeas = journey.items.filter((i) => i.kind === "stay" && i.status === "suggested");

  return (
    <section className="pt-8 sm:pt-12">
      <button type="button" onClick={onBack} className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-charcoal hover:text-ink">
        <ArrowLeft size={14} /> All trips
      </button>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-[clamp(30px,5vw,48px)] leading-tight tracking-[-0.02em]">{journey.title}</h1>
          <p className="mt-2 text-[15px] text-body">
            {[journey.destination, dateRange(journey.startDate, journey.endDate)].filter(Boolean).join(" · ")}
            {when && <span className="text-accent"> · {when}</span>}
          </p>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="quiet" onClick={() => open("edit")} aria-label="Edit trip">
            <Pencil size={14} /> Edit
          </Button>
          <Button size="sm" variant="quiet" onClick={del} aria-label="Delete trip">
            <Trash2 size={14} />
          </Button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2 border-y border-hairline py-3">
        <Button size="sm" variant="ghost" onClick={() => open("add")}>
          <Plus size={14} /> Add
        </Button>
        <Button size="sm" variant="ghost" disabled={!hasDates || suggesting !== null} onClick={() => suggest("dining")} title={hasDates ? "Lunch and dinner ideas for each day, from your food preferences" : "Add dates first"}>
          {suggesting === "dining" ? <Spinner /> : <UtensilsCrossed size={14} />} Plan dining
        </Button>
        <Button size="sm" variant="ghost" disabled={!hasDates || !journey.destination || suggesting !== null} onClick={() => suggest("hotels")} title={hasDates ? "Live hotel prices, picked for what you care about" : "Add dates first"}>
          {suggesting === "hotels" ? <Spinner /> : <Building2 size={14} />} Find hotels
        </Button>
        <span className="text-[12px] text-ash max-sm:w-full">
          {suggesting === "dining" ? "Planning meals around your days…" : suggesting === "hotels" ? "Searching live hotel prices…" : provider ? "Ideas use your saved food and hotel preferences." : "Connect ChatGPT or Grok for dining and hotel ideas."}
        </span>
      </div>
      {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}

      {hotelIdeas.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 flex items-center gap-2 text-[13px] font-medium text-ink">
            <BedDouble size={14} className="text-accent" /> Hotel ideas
          </h2>
          <ul className="space-y-1">
            {hotelIdeas.map((i) => (
              <ItemRow key={i.id} item={i} onChanged={replace} onRemoved={() => drop(i.id)} />
            ))}
          </ul>
        </div>
      )}

      {days.length === 0 ? (
        <div className="mt-8 rounded-lg border border-hairline-strong bg-card p-6 text-[14px] text-mute">
          Nothing here yet. Forward a confirmation, or{" "}
          <button type="button" onClick={() => open("add")} className="cursor-pointer text-accent hover:underline">
            add something
          </button>
          .
        </div>
      ) : (
        <ol className="mt-6 space-y-8">
          {days.map((d) => {
            const items = journey.items.filter((i) => i.startDate === d && !(i.kind === "stay" && i.status === "suggested"));
            const firm = items.filter((i) => i.status !== "suggested").sort(byTime);
            const ideas = items.filter((i) => i.status === "suggested").sort(byTime);
            const stay = stayOn(journey.items, d);
            // On check-in day the stay's own row already says it.
            const sleeping = stay && stay.startDate !== d ? stay : null;
            return (
              <li key={d}>
                <div className="flex items-baseline gap-3 border-b border-hairline pb-2">
                  <h2 className="text-[15px] font-medium text-ink">{day(d)}</h2>
                  {journey.startDate && d >= journey.startDate && d <= (journey.endDate ?? journey.startDate) && <span className="text-[12px] text-ash">Day {Math.round((Date.parse(d) - Date.parse(journey.startDate)) / 86_400_000) + 1}</span>}
                  {sleeping && <span className="ml-auto truncate text-[12px] text-mute">Staying at {sleeping.title}</span>}
                </div>
                {firm.length === 0 && ideas.length === 0 && <p className="px-3 py-3 text-[13px] text-ash">Free day.</p>}
                {firm.length > 0 && (
                  <ul className="mt-1 space-y-1">
                    {firm.map((i) => (
                      <ItemRow key={i.id} item={i} onChanged={replace} onRemoved={() => drop(i.id)} />
                    ))}
                  </ul>
                )}
                {ideas.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {ideas.map((i) => (
                      <ItemRow key={i.id} item={i} onChanged={replace} onRemoved={() => drop(i.id)} />
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {journey.items.some((i) => i.kind === "dining" && i.status === "suggested") && <p className="mt-6 text-[12px] text-ash">Dining ideas come from the AI&apos;s knowledge, not live listings. Check hours and book ahead before you go.</p>}

      <JourneyDialog key={`edit-${formKey}`} open={dialog === "edit"} onClose={() => setDialog(null)} journey={journey} onSaved={() => reload().then(() => setDialog(null)).catch((err) => setError(errorText(err, "Couldn't reload the trip.")))} />
      <AddItemDialog key={`add-${formKey}`} open={dialog === "add"} onClose={() => setDialog(null)} journey={journey} onAdded={() => reload().then(() => setDialog(null)).catch((err) => setError(errorText(err, "Couldn't reload the trip.")))} />
    </section>
  );
}
