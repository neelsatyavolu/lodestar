import { Armchair, CalendarDays, CalendarRange, Car, Hotel, MapPin, Moon, Plane, Repeat, Split, TriangleAlert, Users } from "lucide-react";
import type { Hack, HackKind } from "@/lib/hacks";
import { day, money } from "@/lib/format";
import type { DayPrice } from "@/lib/types";

const ICON: Record<HackKind, typeof Plane> = {
  nearby: MapPin,
  flex: CalendarDays,
  split: Split,
  nonstop: Plane,
  ulcc: TriangleAlert,
  cabin: Armchair,
  position: Car,
  length: CalendarRange,
  group: Users,
  throwaway: Repeat,
  timing: Moon,
  stopover: Hotel,
};
const ACTION: Record<HackKind, string> = {
  nearby: "Show flight",
  flex: "Search these dates",
  split: "Show both tickets",
  nonstop: "Show flight",
  ulcc: "Show flight",
  cabin: "Search that cabin",
  position: "Search from there",
  length: "Search these dates",
  group: "Search one seat",
  throwaway: "Search the round trip",
  timing: "Show flight",
  stopover: "Show flight",
};

export function HackCards({ hacks, onAction }: { hacks: Hack[]; onAction: (h: Hack) => void }) {
  if (!hacks.length) return null;
  return (
    <section aria-label="Ways to save" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {hacks.map((h) => {
        const Icon = ICON[h.kind];
        return (
          <div key={`${h.kind}-${h.title}`} className="flex flex-col rounded-lg border border-hairline-strong bg-card p-4">
            <div className="flex items-start gap-3">
              <Icon size={16} className={`mt-0.5 shrink-0 ${h.kind === "ulcc" ? "text-warn" : "text-charcoal"}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-medium text-ink">{h.title}</h3>
                  {h.saving > 0 && <span className="shrink-0 text-sm text-ink tnum">−{money(h.saving)}</span>}
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-mute">{h.detail}</p>
                {h.caution && <p className="mt-2 text-xs text-ash">{h.caution}</p>}
              </div>
            </div>
            <div className="mt-auto pt-3 pl-7">
              <button type="button" onClick={() => onAction(h)} className="cursor-pointer text-[13px] text-accent hover:underline pointer-coarse:min-h-11">
                {ACTION[h.kind]} →
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

export function DateStrip({ days, selected, onPick }: { days: DayPrice[]; selected: string; onPick: (d: DayPrice) => void }) {
  if (days.length < 2) return null;
  const max = Math.max(...days.map((d) => d.price));
  const min = Math.min(...days.map((d) => d.price));
  return (
    <section aria-label="Prices on nearby dates" className="rounded-lg border border-hairline-strong bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm text-ink">Nearby dates</h3>
        <span className="text-xs text-ash">Lowest fare per departure day{days[0].return ? ", same trip length" : ""}</span>
      </div>
      <div className="flex items-end gap-2 overflow-x-auto pb-1">
        {days.map((d) => {
          const isSel = d.depart === selected;
          const isMin = d.price === min;
          return (
            <button
              key={d.depart}
              type="button"
              onClick={() => onPick(d)}
              aria-pressed={isSel}
              className={`group flex min-w-16 flex-1 cursor-pointer flex-col items-center gap-2 rounded-md p-2 ${isSel ? "bg-elevated" : "hover:bg-hover"}`}
            >
              <span className={`text-xs tnum ${isMin ? "text-accent" : isSel ? "text-ink" : "text-mute"}`}>{money(d.price)}</span>
              <span className="flex h-14 w-full items-end">
                <span
                  className={`w-full rounded-sm ${isMin ? "bg-accent" : isSel ? "bg-ink" : "bg-stone group-hover:bg-ash"}`}
                  style={{ height: `${max === min ? 60 : 25 + ((d.price - min) / (max - min)) * 75}%` }}
                />
              </span>
              <span className={`text-[12px] ${isSel ? "text-ink" : "text-ash"}`}>{day(d.depart).replace(",", "")}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
