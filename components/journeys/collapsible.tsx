import { ChevronDown, MoreHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

// A heading you can fold away, with a "…" menu of actions, as Wanderlog's
// Overview sections and itinerary days work.

export type MenuItem = { label: string; onSelect: () => void; danger?: boolean };

export function MoreMenu({ items, label }: { items: MenuItem[]; label: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div ref={root} className="relative">
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} className="inline-flex size-9 cursor-pointer items-center justify-center rounded-md text-ash hover:bg-hover hover:text-ink">
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <ul role="menu" className="rise absolute right-0 top-full z-30 mt-1 min-w-48 overflow-hidden rounded-lg border border-hairline-strong bg-card py-1">
          {items.map((m) => (
            <li key={m.label} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  m.onSelect();
                }}
                className={`block w-full cursor-pointer px-3 py-2 text-left text-[13px] hover:bg-hover ${m.danger ? "text-danger" : "text-body hover:text-ink"}`}
              >
                {m.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Props = {
  title: ReactNode;
  /** Under the title: a short summary, shown folded or open. */
  sub?: ReactNode;
  /** Right of the title, before the menu: a count, a drive time. */
  aside?: ReactNode;
  menu?: MenuItem[];
  /** The menu button's name, so an agent or screen reader can tell one section's menu from another's. */
  menuLabel?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  id?: string;
  size?: "lg" | "md";
};

export function Collapsible({ title, sub, aside, menu, menuLabel = "More actions", open, onToggle, children, id, size = "lg" }: Props) {
  const panel = useId();
  return (
    <section id={id} className="scroll-mt-32">
      <div className="flex items-start gap-1">
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={panel} className="group -ml-2 flex min-w-0 flex-1 cursor-pointer items-start gap-1.5 rounded-md px-2 py-1 text-left">
          <ChevronDown size={18} className={`mt-[5px] shrink-0 text-ash transition-transform duration-200 ease-[var(--ease)] group-hover:text-ink ${open ? "" : "-rotate-90"}`} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className={`block font-medium tracking-[-0.01em] text-ink [text-wrap:balance] ${size === "lg" ? "text-[18px] leading-7 sm:text-[20px]" : "text-[16px] leading-7"}`}>{title}</span>
            {sub && <span className="mt-0.5 block truncate text-[13px] text-mute">{sub}</span>}
          </span>
        </button>
        {aside && <div className="shrink-0 pt-1.5">{aside}</div>}
        {menu && menu.length > 0 && <MoreMenu items={menu} label={menuLabel} />}
      </div>
      <div id={panel} hidden={!open} className="mt-3">
        {open && children}
      </div>
    </section>
  );
}
