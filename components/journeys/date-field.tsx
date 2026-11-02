import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { addMonths, dayOfMonth, longLabel, monthGrid, monthLabel, monthStart, nightsBetween, shortLabel, type Iso } from "@/lib/calendar";
import { Button } from "../ui";

// The trip organizer's calendar: one date, or a start and end. Unlike the
// flight picker it allows past dates (past trips) and has no fare overlay.

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const today = () => new Date().toLocaleDateString("en-CA");

type Range = { start: Iso | null; end: Iso | null };

function Calendar({ value, range, inline, onPick, onDone }: { value: Range; range: boolean; inline: boolean; onPick: (day: Iso) => void; onDone: () => void }) {
  const [view, setView] = useState<Iso>(monthStart(value.start ?? today()));
  const [hover, setHover] = useState<Iso | null>(null);
  const now = today();
  // While choosing the end, preview up to the hovered day.
  const end = value.end ?? (range && value.start && hover && hover > value.start ? hover : null);
  return (
    <div className={inline ? "mt-2 rounded-lg border border-hairline-strong bg-deep p-3" : "rise absolute left-0 top-full z-40 mt-2 w-[min(620px,calc(100vw-32px))] rounded-xl border border-hairline-strong bg-card p-4 max-sm:left-1/2 max-sm:-translate-x-1/2"}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[12px] text-charcoal">{range ? (value.start && !value.end ? "Now pick the last day" : "Pick the first day") : "Pick a day"}</span>
        <div className="flex gap-1">
          <button type="button" aria-label="Previous month" onClick={() => setView(addMonths(view, -1))} className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-charcoal hover:bg-hover hover:text-ink">
            <ChevronLeft size={16} />
          </button>
          <button type="button" aria-label="Next month" onClick={() => setView(addMonths(view, 1))} className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-charcoal hover:bg-hover hover:text-ink">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="flex gap-6" onMouseLeave={() => setHover(null)}>
        {[view, addMonths(view, 1)].map((month, i) => (
          <div key={month} className={`min-w-0 flex-1 ${i === 1 ? "max-sm:hidden" : ""}`}>
            <div className="mb-2 text-center text-sm font-medium text-ink">{monthLabel(month)}</div>
            <div className="grid grid-cols-7 text-center text-[11px] text-ash">
              {WEEKDAYS.map((w, k) => (
                <div key={k} className="pb-1.5">
                  {w}
                </div>
              ))}
            </div>
            <div role="grid" aria-label={monthLabel(month)} className="grid grid-cols-7 gap-y-1">
              {monthGrid(month)
                .flat()
                .map((day, k) => {
                  if (!day) return <div key={`e${k}`} />;
                  const isStart = day === value.start;
                  const isEnd = day === end;
                  const inside = Boolean(value.start && end && day > value.start && day < end);
                  return (
                    <div key={day} className={`${inside ? "bg-hover" : ""} ${isStart && end && end !== day ? "rounded-l-md bg-hover" : ""} ${isEnd && !isStart ? "rounded-r-md bg-hover" : ""}`}>
                      <button
                        type="button"
                        aria-label={longLabel(day)}
                        aria-pressed={isStart || isEnd}
                        onClick={() => onPick(day)}
                        onMouseEnter={() => setHover(day)}
                        className={`flex h-10 w-full cursor-pointer items-center justify-center rounded-md text-[13px] tnum max-sm:h-11 ${isStart || isEnd ? "bg-primary text-primary-on" : "text-ink hover:bg-hover"}`}
                      >
                        <span className={day === now && !isStart && !isEnd ? "underline decoration-accent decoration-2 underline-offset-4" : ""}>{dayOfMonth(day)}</span>
                      </button>
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-hairline pt-3 text-xs text-ash">
        <span>{range && value.start && value.end ? `${nightsBetween(value.start, value.end)} nights` : ""}</span>
        <Button size="sm" variant="primary" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), setOpen(false));
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key, true);
    };
  }, [open]);
  return { open, setOpen, root };
}

const fieldClass = "flex h-10 w-full cursor-pointer items-center gap-2 rounded-md border border-hairline-strong bg-deep px-3 text-left text-[14px] text-ink hover:border-hairline-hover max-sm:h-12";

/** One date. */
/** `inline` opens the calendar in place (inside dialogs, where a popover would be clipped). */
export function DateField({ value, onChange, placeholder = "Pick a day", label, inline = false }: { value: Iso | null; onChange: (d: Iso) => void; placeholder?: string; label: string; inline?: boolean }) {
  const { open, setOpen, root } = usePopover();
  return (
    <div ref={root} className="relative">
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)} className={fieldClass}>
        <CalendarDays size={14} className="shrink-0 text-ash" />
        <span className={value ? "tnum" : "text-stone"}>{value ? shortLabel(value) : placeholder}</span>
      </button>
      {open && (
        <Calendar
          value={{ start: value, end: null }}
          range={false}
          inline={inline}
          onPick={(d) => {
            onChange(d);
            setOpen(false);
          }}
          onDone={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/** A first and last day, picked on one calendar. */
export function DateRangeField({ start, end, onChange, label, inline = false }: { start: Iso | null; end: Iso | null; onChange: (start: Iso | null, end: Iso | null) => void; label: string; inline?: boolean }) {
  const { open, setOpen, root } = usePopover();
  const pick = (d: Iso) => {
    // First click (or a click before the start) begins a new range; the next one ends it.
    if (!start || end || d < start) return onChange(d, null);
    onChange(start, d);
    setOpen(false);
  };
  const text = start ? `${shortLabel(start)}${end && end !== start ? ` – ${shortLabel(end)}` : ""}` : "Add dates";
  return (
    <div ref={root} className="relative">
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)} className={fieldClass}>
        <CalendarDays size={14} className="shrink-0 text-ash" />
        <span className={start ? "tnum" : "text-stone"}>{text}</span>
      </button>
      {open && <Calendar value={{ start, end }} range inline={inline} onPick={pick} onDone={() => setOpen(false)} />}
    </div>
  );
}
