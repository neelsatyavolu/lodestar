// The trip page's tabs, kept in the address (?trip=<id>&tab=book) so a reload
// or a shared link lands where you were.

export const TABS = [
  { id: "overview", label: "Overview" },
  { id: "itinerary", label: "Itinerary" },
  { id: "book", label: "To book" },
  { id: "bookings", label: "Bookings" },
  { id: "budget", label: "Budget" },
  { id: "checklist", label: "Checklist" },
] as const;
export type Tab = (typeof TABS)[number]["id"];

const isTab = (v: string | null): v is Tab => TABS.some((t) => t.id === v);

/** The trip and tab in the address, if any. */
export function readLocation(): { trip: string | null; tab: Tab | null } {
  if (typeof window === "undefined") return { trip: null, tab: null };
  const q = new URLSearchParams(window.location.search);
  const tab = q.get("tab");
  return { trip: q.get("trip"), tab: isTab(tab) ? tab : null };
}

/** Writes the open trip and tab to the address without a navigation; null clears both. */
export function writeLocation(trip: string | null, tab: Tab | null): void {
  const url = new URL(window.location.href);
  if (trip) url.searchParams.set("trip", trip);
  else url.searchParams.delete("trip");
  if (trip && tab && tab !== "overview") url.searchParams.set("tab", tab);
  else url.searchParams.delete("tab");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

export function TabBar({ tab, onChange, counts }: { tab: Tab; onChange: (t: Tab) => void; counts: Partial<Record<Tab, string>> }) {
  return (
    <nav aria-label="Trip sections" className="sticky top-16 z-20 -mx-4 border-b border-hairline bg-canvas/95 px-4 backdrop-blur sm:-mx-0 sm:px-0">
      <ul className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <li key={t.id} className="shrink-0">
              <button
                type="button"
                onClick={() => onChange(t.id)}
                aria-current={active ? "page" : undefined}
                className={`relative inline-flex h-11 cursor-pointer items-center gap-1.5 px-3 text-[14px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${active ? "text-ink" : "text-mute hover:text-charcoal"}`}
              >
                {t.label}
                {counts[t.id] && <span className={`tnum rounded-full px-1.5 text-[11px] leading-[18px] ${active ? "bg-tint text-accent" : "bg-elevated text-mute"}`}>{counts[t.id]}</span>}
                <span className={`absolute inset-x-3 -bottom-px h-0.5 rounded-full ${active ? "bg-accent" : "bg-transparent"}`} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
