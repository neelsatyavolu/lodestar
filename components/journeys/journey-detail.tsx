import { useCallback, useEffect, useRef, useState } from "react";
import { api, post } from "@/lib/client";
import { byItinerary, lookupsFor, searchCenter } from "@/lib/journeys/locate";
import { locateWithOsm } from "@/lib/places/locate-osm";
import { osmSearch } from "@/lib/places/osm";
import { toBook } from "@/lib/journeys/plan";
import type { Item, TripDetail } from "@/lib/journeys/types";
import type { Provider } from "../connect-ai";
import { Dialog } from "../dialog";
import { useGenerate } from "./ai-draft";
import { BookingsTab } from "./bookings-tab";
import { BudgetTab } from "./budget-tab";
import { ChecklistTab } from "./checklist-tab";
import { DraftProgress, useDraftRun } from "./draft-run";
import { AddItemDialog, JourneyDialog } from "./forms";
import { ItineraryTab } from "./itinerary-tab";
import { OverviewTab, type AddPreset } from "./overview-tab";
import { PlacePanel } from "./place-panel";
import type { DraftRequest } from "./quick-start";
import { FlightsTab } from "./flights-tab";
import { HotelsTab } from "./hotels-tab";
import { ShareDialog } from "./share-dialog";
import { daysOf, errorText, fullTrip, today, type PlanTrip } from "./shared";
import { readLocation, TabBar, TABS, writeLocation, type Tab } from "./tabs";
import { ToBookTab } from "./to-book-tab";
import { TripCover } from "./trip-cover";
import { TripMap } from "./trip-map";
import { useFlights } from "./use-flights";
import { askConfirm } from "../confirm";

// One trip: a header with the destination's photo, tabs for each part of the
// plan, and on wide screens a map on the right that stays in view. Opening a
// stop shows its details over the map (a sheet on phones).

type Props = {
  journey: PlanTrip;
  provider: Provider | null;
  onConnectAi: () => void;
  onBack: () => void;
  /** Applied to the latest copy, so two quick actions never undo each other. */
  onChanged: (update: (j: PlanTrip) => PlanTrip) => void;
  onDeleted: () => void;
  /** Set right after the quick start asked for a draft: runs once the trip has loaded. */
  autoDraft: DraftRequest | null;
  /** Called when that draft starts, so the request is used up. */
  onAutoDraftStarted: () => void;
};

const WIDE = "(min-width: 1024px)";
const LOCATE_ROUNDS = 6;
/** How long one round of in-browser lookups runs before saving what it has. */
const BROWSER_BUDGET_MS = 30_000;

export function JourneyDetail({ journey, provider, onConnectAi, onBack, onChanged, onDeleted, autoDraft, onAutoDraftStarted }: Props) {
  const trip = fullTrip(journey);
  const tripId = journey.id;
  const loaded = journey.tasks !== undefined;
  const [tab, setTab] = useState<Tab>(() => readLocation().tab ?? (autoDraft ? "itinerary" : "overview"));
  const [suggesting, setSuggesting] = useState<"dining" | "hotels" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"edit" | "add" | "share" | null>(null);
  const [preset, setPreset] = useState<AddPreset | undefined>(undefined);
  const [formKey, setFormKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(() => readLocation().item);
  const days = daysOf(trip);
  const [activeDay, setActiveDay] = useState<string | null>(() => days.find((d) => d >= today()) ?? days[0] ?? null);
  const [mobileMap, setMobileMap] = useState(false);
  const [wide, setWide] = useState(true);
  const located = useRef(false);
  const selected = trip.items.find((i) => i.id === selectedId) ?? null;

  const change = useCallback((update: (t: TripDetail) => TripDetail) => onChanged((j) => update(fullTrip(j))), [onChanged]);
  const setTrip = useCallback((t: TripDetail) => onChanged(() => t), [onChanged]);
  const gen = useGenerate(tripId, provider, onConnectAi, setTrip);
  const draft = useDraftRun(gen, autoDraft, loaded, onAutoDraftStarted);
  const flights = useFlights(tripId, trip.items);

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

  // An item id in the address only counts once the trip has loaded and holds it.
  const shownItem = selected?.id ?? (trip.items.length ? null : selectedId);
  useEffect(() => writeLocation(tripId, tab, shownItem), [tripId, tab, shownItem]);

  // The window title says where you are: what an agent reading tabs or screenshots checks first.
  const tabLabel = TABS.find((t) => t.id === tab)?.label;
  useEffect(() => {
    const before = document.title;
    document.title = [selected?.title, `${trip.title} · ${tabLabel}`, "Lodestar"].filter(Boolean).join(" · ");
    return () => {
      document.title = before;
    };
  }, [trip.title, tabLabel, selected?.title]);

  const reload = useCallback(async () => {
    const { journey: next } = await api<{ journey: TripDetail }>(`/api/journeys/${tripId}`);
    setTrip(next);
  }, [tripId, setTrip]);

  // The list holds items only; the checklist, notes and costs come with the full trip.
  // Keyed on the trip alone: `reload` changes whenever the parent re-renders.
  const reloadNow = useRef(reload);
  useEffect(() => {
    reloadNow.current = reload;
  }, [reload]);
  useEffect(() => {
    reloadNow.current().catch((err) => setError(errorText(err, "Couldn't load the whole trip.")));
  }, [tripId]);

  // Pin bookings that came from email, an import or an agent, once per visit: a call pins a
  // dozen, so keep calling while some are left and the last call settled some. Without Google
  // the server asks the page to do the OpenStreetMap searches itself and save what it found.
  useEffect(() => {
    // Asked as Google would: the server knows which search it has and skips what that one can't find.
    if (located.current || !loaded || !lookupsFor(journey, Date.now(), "google").length) return;
    located.current = true;
    (async () => {
      type Located = { journey: TripDetail; settled: number; remaining: number; browser?: boolean };
      const url = `/api/journeys/${tripId}/locate`;
      const inBrowser = (j: TripDetail) => locateWithOsm(lookupsFor(j, Date.now()), osmSearch, BROWSER_BUDGET_MS).then((results) => post<Located>(url, { results }));
      // Once the server has said "do it yourself", later rounds go straight to the browser.
      let here = false;
      let current: TripDetail | null = null;
      for (let round = 0; round < LOCATE_ROUNDS; round++) {
        let r: Located = here && current ? await inBrowser(current) : await post<Located>(url, {});
        if (r.browser) {
          here = true;
          r = await inBrowser(r.journey);
        }
        current = r.journey;
        change((t) => ({ ...t, items: r.journey.items }));
        // Search down or slow: nothing settled, so another call now would only repeat it.
        if (!r.remaining || !r.settled) break;
      }
    })().catch(() => {});
  }, [journey, tripId, loaded, change]);

  const suggest = async (kind: "dining" | "hotels") => {
    if (!provider) return onConnectAi();
    setSuggesting(kind);
    setError(null);
    try {
      const { journey: next } = await post<{ journey: TripDetail }>(`/api/journeys/${trip.id}/suggest`, { provider, kind });
      change((t) => ({ ...t, items: next.items }));
    } catch (err) {
      setError(errorText(err, "The suggestions didn't come through. Try again."));
    } finally {
      setSuggesting(null);
    }
  };

  const del = async () => {
    if (!(await askConfirm(`Delete ${trip.title}?`, "Delete trip", "Everything in it goes too: the itinerary, checklist, notes and budget."))) return;
    try {
      await api(`/api/journeys/${trip.id}`, { method: "DELETE" });
      writeLocation(null, null);
      onDeleted();
    } catch (err) {
      setError(errorText(err, "Couldn't delete the trip."));
    }
  };

  const replace = (it: Item) => change((t) => ({ ...t, items: t.items.map((x) => (x.id === it.id ? it : x)) }));
  const drop = (id: string) => {
    if (id === selectedId) setSelectedId(null);
    change((t) => ({ ...t, items: t.items.filter((x) => x.id !== id) }));
  };
  const openDialog = (d: "edit" | "add" | "share", p?: AddPreset) => {
    setFormKey((k) => k + 1);
    setPreset(p);
    setDialog(d);
  };
  const open = (id: string) => {
    const item = trip.items.find((i) => i.id === id);
    setSelectedId(id);
    if (item) setActiveDay(item.startDate);
    if (!wide) setMobileMap(false);
  };
  const fromMap = (id: string) => {
    open(id);
    if (tab === "itinerary") document.getElementById(`day-${trip.items.find((i) => i.id === id)?.startDate}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const reloadOrError = () => reload().catch((err) => setError(errorText(err, "Couldn't reload the trip.")));
  const goTab = (t: Tab) => {
    setTab(t);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Step through the selected stop's day, as Wanderlog's "1 of 3".
  const dayList = selected ? trip.items.filter((i) => i.startDate === selected.startDate && i.kind !== "note" && i.status !== "cancelled" && i.status !== "suggested").sort(byItinerary) : [];
  const at = selected ? dayList.findIndex((i) => i.id === selected.id) : -1;
  const pager = at >= 0 && dayList.length > 1 ? { index: at, total: dayList.length, go: (k: number) => open(dayList[(k + dayList.length) % dayList.length].id) } : undefined;

  const panel = selected && (
    <PlacePanel key={selected.id} item={selected} near={searchCenter(trip.items, selected.startDate)} bare={!wide} pager={pager} onClose={() => setSelectedId(null)} onChanged={replace} onRemoved={() => drop(selected.id)} />
  );

  const open_ = toBook(trip.items).length;
  const done = trip.tasks.filter((t) => t.done).length;
  const flightCount = trip.items.filter((i) => i.kind === "flight" && i.status !== "suggested" && i.status !== "cancelled").length;
  const stayCount = trip.items.filter((i) => i.kind === "stay" && i.status !== "suggested" && i.status !== "cancelled").length;
  const counts: Partial<Record<Tab, string>> = {
    ...(flightCount ? { flights: String(flightCount) } : {}),
    ...(stayCount ? { hotels: String(stayCount) } : {}),
    ...(open_ ? { book: String(open_) } : {}), ...(trip.tasks.length ? { checklist: `${done}/${trip.tasks.length}` } : {}) };

  return (
    // Wide screens break out of the page column: plan left, map right.
    <section className="pt-6 sm:pt-12 lg:relative lg:left-1/2 lg:-ml-[50vw] lg:w-screen lg:pt-0">
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(380px,42%)]">
        <div className="w-full lg:ml-auto lg:max-w-[780px] lg:px-6 lg:pb-24 lg:pt-8">
          <TripCover journey={trip} onBack={() => (writeLocation(null, null), onBack())} onEdit={() => openDialog("edit")} onShare={() => openDialog("share")} onDelete={del} />
          {draft.state && (
            <div className="mt-5">
              <DraftProgress run={draft} gen={gen} />
            </div>
          )}
          <div className="mt-6">
            <TabBar tab={tab} onChange={goTab} counts={counts} />
          </div>
          {error && <p className="mt-4 text-[13px] text-danger">{error}</p>}
          <div className="mt-6">
            {tab === "overview" && (
              <OverviewTab trip={trip} gen={gen} selectedId={selectedId} onOpenItem={open} onTab={goTab} onAdd={(p) => openDialog("add", p)} onNotes={(u) => change((t) => ({ ...t, notes: u(t.notes) }))} onReplace={replace} onDrop={drop} />
            )}
            {tab === "itinerary" && (
              <ItineraryTab
                trip={trip}
                days={days}
                gen={gen}
                activeDay={activeDay}
                selectedId={selectedId}
                suggesting={suggesting}
                onSuggest={suggest}
                onFocusDay={setActiveDay}
                onOpen={open}
                flights={flights}
                onReplace={replace}
                onDrop={drop}
                onAdded={reloadOrError}
                onAddBooking={() => openDialog("add")}
                onEdit={() => openDialog("edit")}
                onMap={() => setMobileMap(true)}
              />
            )}
            {tab === "flights" && <FlightsTab trip={trip} flights={flights} onOpenItem={open} onAdd={() => openDialog("add", { kind: "flight" })} />}
            {tab === "hotels" && <HotelsTab trip={trip} onOpenItem={open} onAdd={() => openDialog("add", { kind: "stay" })} />}
            {tab === "book" && <ToBookTab trip={trip} gen={gen} onOpenItem={open} onReplace={replace} />}
            {tab === "bookings" && <BookingsTab trip={trip} onOpenItem={open} onAdd={() => openDialog("add")} />}
            {tab === "budget" && <BudgetTab trip={trip} gen={gen} onOpenItem={open} onCosts={(u) => change((t) => ({ ...t, costs: u(t.costs) }))} />}
            {tab === "checklist" && <ChecklistTab trip={trip} gen={gen} onTasks={(u) => change((t) => ({ ...t, tasks: u(t.tasks) }))} />}
          </div>
          {gen.notice && !gen.running && <p className="mt-6 text-[12px] text-mute">{gen.notice}</p>}
        </div>

        {wide && (
          <aside className="sticky top-16 hidden h-[calc(100dvh-64px)] overflow-hidden border-l border-hairline [contain:paint] lg:block">
            <TripMap items={trip.items} selectedId={selectedId} day={tab === "itinerary" ? activeDay : null} onSelect={fromMap} panelOpen={Boolean(panel)} />
            {panel && <div className="absolute inset-x-3 bottom-3 z-10 max-h-[66%] overflow-hidden rounded-xl border border-hairline-strong bg-card">{panel}</div>}
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
              <TripMap items={trip.items} selectedId={selectedId} day={activeDay} onSelect={open} />
            </div>
          </Dialog>
        </>
      )}

      <JourneyDialog key={`edit-${formKey}`} open={dialog === "edit"} onClose={() => setDialog(null)} journey={trip} onSaved={() => reload().then(() => setDialog(null)).catch((err) => setError(errorText(err, "Couldn't reload the trip.")))} />
      <AddItemDialog key={`add-${formKey}`} open={dialog === "add"} onClose={() => setDialog(null)} journey={trip} preset={preset} onAdded={() => reload().then(() => setDialog(null)).catch((err) => setError(errorText(err, "Couldn't reload the trip.")))} />
      <ShareDialog open={dialog === "share"} onClose={() => setDialog(null)} journeyId={trip.id} token={trip.shareToken} onToken={(shareToken) => change((t) => ({ ...t, shareToken }))} />
    </section>
  );
}
