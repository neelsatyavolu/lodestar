import { CalendarDays, MapPin, Plane, Split, TriangleAlert } from "lucide-react";
import type { Hack, HackKind } from "@/lib/hacks";
import { day, money } from "@/lib/format";
import type { DayPrice } from "@/lib/types";

const ICON: Record<HackKind, typeof Plane> = { nearby: MapPin, flex: CalendarDays, split: Split, nonstop: Plane, ulcc: TriangleAlert };
const ACTION: Record<HackKind, string> = { nearby: "Show flight", flex: "Search these dates", split: "Show both tickets", nonstop: "Show flight", ulcc: "Show flight" };

export function HackCards({ hacks, onAction }: { hacks: Hack[]; onAction: (h: Hack) => void }) {
  if (!hacks.length) return null;
  return (
    <section aria-label="Ways to save" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {hacks.map((h) => {
        const Icon = ICON[h.kind];
        return (
          <div key={`${h.kind}-${h.title}`} className="flex flex-col rounded-lg border border-hairline-strong bg-card p-4">
            <div className="flex items-start gap-3">
              <Icon size={16} className={`mt-0.5 shrink-0 ${h.kind === "ulcc" ? "text-yellow" : "text-charcoal"}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-medium text-ink">{h.title}</h3>
                  {h.saving > 0 && <span className="shrink-0 text-sm text-green tnum">−{money(h.saving)}</span>}
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-mute">{h.detail}</p>
                {h.caution && <p className="mt-2 text-xs text-ash">{h.caution}</p>}
              </div>
            </div>
            <div className="mt-auto pt-3 pl-7">
              <button type="button" onClick={() => onAction(h)} className="cursor-pointer text-[13px] text-blue hover:underline">
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
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm text-ink">Nearby dates</h3>
        <span className="text-xs text-ash">Lowest fare per departure day{days[0].return ? ", same trip length" : ""}</span>
      </div>
      <div className="flex items-end gap-1.5 overflow-x-auto pb-1">
        {days.map((d) => {
          const isSel = d.depart === selected;
          const isMin = d.price === min;
          return (
            <button
              key={d.depart}
              type="button"
              onClick={() => onPick(d)}
              aria-pressed={isSel}
              className={`group flex min-w-16 flex-1 cursor-pointer flex-col items-center gap-1.5 rounded-md p-1.5 ${isSel ? "bg-elevated" : "hover:bg-[rgba(255,255,255,0.03)]"}`}
            >
              <span className={`text-xs tnum ${isMin ? "text-green" : isSel ? "text-ink" : "text-mute"}`}>{money(d.price)}</span>
              <span className="flex h-14 w-full items-end">
                <span
                  className={`w-full rounded-sm ${isMin ? "bg-green/70" : isSel ? "bg-ink" : "bg-stone group-hover:bg-ash"}`}
                  style={{ height: `${max === min ? 60 : 25 + ((d.price - min) / (max - min)) * 75}%` }}
                />
              </span>
              <span className={`text-[11px] ${isSel ? "text-ink" : "text-ash"}`}>{day(d.depart).replace(",", "")}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
