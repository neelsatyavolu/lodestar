import { ArrowLeft, BedDouble, Building2, Map as MapIcon, Pencil, Plus, Trash2, UtensilsCrossed } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, post } from "@/lib/client";
import { lookupsFor, searchCenter } from "@/lib/journeys/locate";
import type { Item, JourneyWithItems } from "@/lib/journeys/types";
import type { Provider } from "../connect-ai";
import { Dialog } from "../dialog";
import { Button, Spinner } from "../ui";
import { DaySection } from "./day-section";
import { AddItemDialog, JourneyDialog } from "./forms";
import { ItemRow } from "./item-row";
import { PlacePanel } from "./place-panel";
import { countdown, dateRange, daysOf, errorText, today } from "./shared";
import { TripMap } from "./trip-map";

// One trip: the itinerary on the left, day by day, and on wide screens a map
// on the right that stays in view. Opening a stop shows its details over the
// map (a sheet on phones).

type Props = {
  journey: JourneyWithItems;
  provider: Provider | null;
  onConnectAi: () => void;
  onBack: () => void;
  /** Applied to the latest copy, so two quick actions never undo each other. */
  onChanged: (update: (j: JourneyWithItems) => JourneyWithItems) => void;
  onDeleted: () => void;
};

const WIDE = "(min-width: 1024px)";
const LOCATE_ROUNDS = 6;

export function JourneyDetail({ journey, provider, onConnectAi, onBack, onChanged, onDeleted }: Props) {
  const [suggesting, setSuggesting] = useState<"dining" | "hotels" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"edit" | "add" | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const days = daysOf(journey);
  const [activeDay, setActiveDay] = useState<string | null>(() => days.find((d) => d >= today()) ?? days[0] ?? null);
  const [mobileMap, setMobileMap] = useState(false);
  const [wide, setWide] = useState(true);
  const located = useRef(false);
  const when = countdown(journey);
  const hasDates = Boolean(journey.startDate);
  const selected = journey.items.find((i) => i.id === selectedId) ?? null;

  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const sync = () => setWide(mq.matches);
    mq.addEventListener("change", sync);
    const t = setTimeout(sync, 0);
    return () => {
      clearTimeout(t);
      mq.removeEventListener("change", sync);
    };
  }, []);

  const reload = useCallback(async () => {
    const { journey: next } = await api<{ journey: JourneyWithItems }>(`/api/journeys/${journey.id}`);
    onChanged(() => next);
  }, [journey.id, onChanged]);

  // Pin bookings that came from email or an import, once per visit: a call pins a dozen,
  // so keep calling while some are left and the last call settled some.
  useEffect(() => {
    if (located.current || !lookupsFor(journey, Date.now()).length) return;
    located.current = true;
    (async () => {
      for (let round = 0; round < LOCATE_ROUNDS; round++) {
        const r = await post<{ journey: JourneyWithItems; settled: number; remaining: number }>(`/api/journeys/${journey.id}/locate`, {});
        onChanged(() => r.journey);
        // Search down or slow: nothing settled, so another call now would only repeat it.
        if (!r.remaining || !r.settled) break;
      }
    })().catch(() => {});
  }, [journey, onChanged]);

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
  const drop = (id: string) => {
    if (id === selectedId) setSelectedId(null);
    onChanged((j) => ({ ...j, items: j.items.filter((x) => x.id !== id) }));
  };
  const openForm = (d: "edit" | "add") => {
    setFormKey((k) => k + 1);
    setDialog(d);
  };
  const open = (id: string) => {
    const item = journey.items.find((i) => i.id === id);
    setSelectedId(id);
    if (item) setActiveDay(item.startDate);
  };
  const fromMap = (id: string) => {
    open(id);
    document.getElementById(`day-${journey.items.find((i) => i.id === id)?.startDate}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const reloadOrError = () => reload().catch((err) => setError(errorText(err, "Couldn't reload the trip.")));
  const hotelIdeas = journey.items.filter((i) => i.kind === "stay" && i.status === "suggested");

  const panel = selected && (
    <PlacePanel key={selected.id} item={selected} near={searchCenter(journey.items, selected.startDate)} bare={!wide} onClose={() => setSelectedId(null)} onChanged={replace} onRemoved={() => drop(selected.id)} />
  );

  return (
    // Wide screens break out of the page column: itinerary left, map right.
    <section className="pt-8 sm:pt-12 lg:relative lg:left-1/2 lg:-ml-[50vw] lg:w-screen lg:pt-0">
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(380px,44%)]">
        <div className="w-full lg:ml-auto lg:max-w-[760px] lg:px-8 lg:pb-24 lg:pt-12">
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
              <Button size="sm" variant="quiet" onClick={() => openForm("edit")} aria-label="Edit trip">
                <Pencil size={14} /> Edit
              </Button>
              <Button size="sm" variant="quiet" onClick={del} aria-label="Delete trip">
                <Trash2 size={14} />
              </Button>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2 border-y border-hairline py-3">
            <Button size="sm" variant="ghost" onClick={() => openForm("add")}>
              <Plus size={14} /> Add booking
            </Button>
            <Button size="sm" variant="ghost" disabled={!hasDates || suggesting !== null} onClick={() => suggest("dining")} title={hasDates ? "Lunch and dinner ideas for each day, from your food preferences" : "Add dates first"}>
              {suggesting === "dining" ? <Spinner /> : <UtensilsCrossed size={14} />} Plan dining
            </Button>
            <Button size="sm" variant="ghost" disabled={!hasDates || !journey.destination || suggesting !== null} onClick={() => suggest("hotels")} title={hasDates ? "Live hotel prices, picked for what you care about" : "Add dates first"}>
              {suggesting === "hotels" ? <Spinner /> : <Building2 size={14} />} Find hotels
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMobileMap(true)} className="lg:hidden">
              <MapIcon size={14} /> Map
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
                  <ItemRow key={i.id} item={i} selected={i.id === selectedId} onOpen={() => open(i.id)} onChanged={replace} onRemoved={() => drop(i.id)} />
                ))}
              </ul>
            </div>
          )}

          {days.length === 0 ? (
            <div className="mt-8 rounded-lg border border-hairline-strong bg-card p-6 text-[14px] text-mute">
              Give the trip dates to plan it day by day.{" "}
              <button type="button" onClick={() => openForm("edit")} className="cursor-pointer text-accent hover:underline">
                Add dates
              </button>
            </div>
          ) : (
            <ol className="mt-6 space-y-8">
              {days.map((d) => (
                <DaySection
                  key={d}
                  journey={journey}
                  date={d}
                  active={d === activeDay}
                  selectedId={selectedId}
                  onFocusDay={() => setActiveDay(d)}
                  onOpen={open}
                  onReplace={replace}
                  onDrop={drop}
                  onAdded={reloadOrError}
                />
              ))}
            </ol>
          )}
          {journey.items.some((i) => i.kind === "dining" && i.status === "suggested") && <p className="mt-6 text-[12px] text-ash">Dining ideas come from the AI&apos;s knowledge, not live listings. Check hours and book ahead before you go.</p>}
        </div>

        {wide && (
          <aside className="sticky top-16 hidden h-[calc(100dvh-64px)] border-l border-hairline lg:block">
            <TripMap items={journey.items} selectedId={selectedId} day={activeDay} onSelect={fromMap} panelOpen={Boolean(panel)} />
            {panel && <div className="absolute inset-x-3 bottom-3 z-10 max-h-[62%] overflow-hidden rounded-xl border border-hairline-strong bg-card">{panel}</div>}
          </aside>
        )}
      </div>

      {!wide && (
        <>
          <Dialog open={Boolean(selected) && !mobileMap} onClose={() => setSelectedId(null)} title={selected?.title ?? ""} width={560}>
            {panel}
          </Dialog>
          <Dialog open={mobileMap} onClose={() => setMobileMap(false)} title="Map" width={900}>
            <div className="h-[70dvh]">
              <TripMap
                items={journey.items}
                selectedId={selectedId}
                day={activeDay}
                onSelect={(id) => {
                  setMobileMap(false);
                  open(id);
                }}
              />
            </div>
          </Dialog>
        </>
      )}

      <JourneyDialog key={`edit-${formKey}`} open={dialog === "edit"} onClose={() => setDialog(null)} journey={journey} onSaved={() => reload().then(() => setDialog(null)).catch((err) => setError(errorText(err, "Couldn't reload the trip.")))} />
      <AddItemDialog key={`add-${formKey}`} open={dialog === "add"} onClose={() => setDialog(null)} journey={journey} onAdded={() => reload().then(() => setDialog(null)).catch((err) => setError(errorText(err, "Couldn't reload the trip.")))} />
    </section>
  );
}
