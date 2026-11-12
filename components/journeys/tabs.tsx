// The trip page's tabs, kept in the address (?trip=<id>&tab=book&item=<id>)
// so a reload, a shared link or an agent driving the browser lands where you
// were, with the open stop's details showing.

export const TABS = [
  { id: "overview", label: "Overview" },
  { id: "itinerary", label: "Itinerary" },
  { id: "flights", label: "Flights" },
  { id: "hotels", label: "Hotels" },
  { id: "book", label: "To book" },
  { id: "bookings", label: "Bookings" },
  { id: "budget", label: "Budget" },
  { id: "checklist", label: "Checklist" },
] as const;
export type Tab = (typeof TABS)[number]["id"];

const isTab = (v: string | null): v is Tab => TABS.some((t) => t.id === v);

/** The trip, tab and open item in the address, if any. */
export function readLocation(): { trip: string | null; tab: Tab | null; item: string | null } {
  if (typeof window === "undefined") return { trip: null, tab: null, item: null };
  const q = new URLSearchParams(window.location.search);
  const tab = q.get("tab");
  return { trip: q.get("trip"), tab: isTab(tab) ? tab : null, item: q.get("item") };
}

/** Writes the open trip, tab and item to the address without a navigation; null clears them. */
export function writeLocation(trip: string | null, tab: Tab | null, item: string | null = null): void {
  const url = new URL(window.location.href);
  if (trip) url.searchParams.set("trip", trip);
  else url.searchParams.delete("trip");
  if (trip && tab && tab !== "overview") url.searchParams.set("tab", tab);
  else url.searchParams.delete("tab");
  if (trip && item) url.searchParams.set("item", item);
  else url.searchParams.delete("item");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

export function TabBar({ tab, onChange, counts }: { tab: Tab; onChange: (t: Tab) => void; counts: Partial<Record<Tab, string>> }) {
  return (
    <nav aria-label="Trip sections" className="sticky top-16 z-20 -mx-4 border-b border-hairline bg-canvas px-4 sm:-mx-0 sm:px-0">
      <ul className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <li key={t.id} className="shrink-0">
              <button
                type="button"
                onClick={() => onChange(t.id)}
                aria-current={active ? "page" : undefined}
                className={`relative inline-flex h-11 cursor-pointer items-center gap-2 px-3 text-[14px] transition-colors duration-150 ${active ? "text-ink" : "text-mute hover:text-charcoal"}`}
              >
                {t.label}
                {counts[t.id] && <span className={`tnum rounded-full px-2 text-[12px] leading-[18px] ${active ? "bg-tint text-accent" : "bg-elevated text-mute"}`}>{counts[t.id]}</span>}
                <span className={`absolute inset-x-3 -bottom-px h-0.5 rounded-full ${active ? "bg-accent" : "bg-transparent"}`} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
