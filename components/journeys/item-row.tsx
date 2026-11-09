import { BedDouble, CarFront, ExternalLink, Plane, StickyNote, Ticket, TrainFront, Trash2, UtensilsCrossed, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/client";
import type { Item, Kind } from "@/lib/journeys/types";
import { Button, Pill } from "../ui";
import type { Pin } from "./pins";
import { errorText } from "./shared";
import { askConfirm } from "../confirm";

// One flight, stay, reservation or plan. Suggestions are drawn dashed with
// Keep and Dismiss so they never read as bookings.

const ICON: Record<Kind, typeof Plane> = { flight: Plane, stay: BedDouble, dining: UtensilsCrossed, activity: Ticket, transport: TrainFront, note: StickyNote };

function subtitle(i: Item): string {
  const d = i.details;
  const parts = [
    i.endTime && i.kind === "flight" ? `arrives ${i.endTime}${i.endDate && i.endDate !== i.startDate ? " next day" : ""}` : null,
    i.kind === "stay" && i.endDate ? `${i.status === "suggested" ? "" : "check-out "}${i.endDate.slice(5).replace("-", "/")}` : null,
    d.cuisine,
    d.priceLevel,
    d.address ?? i.place,
    d.guests ? `${d.guests} guests` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

/** `pin`: the item's numbered, day-coloured map pin, drawn in place of its icon. */
export function ItemRow({ item, pin, onChanged, onRemoved, onOpen, selected = false }: { item: Item; pin?: Pin; onChanged: (i: Item) => void; onRemoved: () => void; onOpen?: () => void; selected?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Icon = item.kind === "transport" && /pickup|car/i.test(item.title) ? CarFront : ICON[item.kind];
  const suggested = item.status === "suggested";
  const cancelled = item.status === "cancelled";

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const { item: next } = await api<{ item: Item }>(`/api/journeys/items/${item.id}`, { method: "PATCH", body: JSON.stringify(body) });
      onChanged(next);
    } catch (err) {
      setError(errorText(err, "Couldn't update it."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!suggested && !(await askConfirm(`Remove ${item.title}?`, "Remove"))) return;
    setBusy(true);
    try {
      await api(`/api/journeys/items/${item.id}`, { method: "DELETE" });
      onRemoved();
    } catch (err) {
      setError(errorText(err, "Couldn't remove it."));
      setBusy(false);
    }
  };

  const link = item.details.url;
  return (
    <li
      onClick={onOpen}
      className={`group flex gap-3 rounded-lg px-3 py-3 ${onOpen ? "cursor-pointer" : ""} ${selected ? "border border-hairline-hover bg-elevated" : suggested ? "border border-dashed border-hairline-strong" : "border border-transparent hover:bg-elevated"}`}
    >
      <span className="w-12 shrink-0 pt-0.5 font-mono text-[12px] text-ash">{item.startTime ?? ""}</span>
      {pin ? (
        <span
          className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
          style={suggested ? { border: `1.5px dashed ${pin.color.fill}`, color: pin.color.fill } : { background: pin.color.fill, color: pin.color.ink }}
          title="On the map"
        >
          {item.kind === "stay" || item.kind === "flight" ? <Icon size={12} aria-hidden /> : pin.n}
        </span>
      ) : (
        <Icon size={16} className={`mt-0.5 shrink-0 ${suggested ? "text-accent" : "text-charcoal"}`} aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {onOpen ? (
            <button type="button" onClick={(e) => (e.stopPropagation(), onOpen())} className={`cursor-pointer text-left text-[14px] hover:underline ${cancelled ? "text-ash line-through" : "text-ink"}`}>
              {item.title}
            </button>
          ) : (
            <span className={`text-[14px] ${cancelled ? "text-ash line-through" : "text-ink"}`}>{item.title}</span>
          )}
          {item.status === "booked" && <Pill dot="ok">Booked</Pill>}
          {cancelled && <Pill dot="danger">Cancelled</Pill>}
          {suggested && <Pill tone="accent">Idea</Pill>}
          {item.confirmation && <span className="font-mono text-[12px] text-mute" title="Confirmation">{item.confirmation}</span>}
        </div>
        {subtitle(item) && <p className="mt-1 text-[13px] text-mute">{subtitle(item)}</p>}
        {item.details.why && <p className="mt-1 text-[13px] text-body">{item.details.why}</p>}
        {item.details.price !== undefined && item.kind === "stay" && suggested && <p className="mt-1 text-[13px] text-body">From ${item.details.price} a night on today&apos;s search{item.details.rating ? ` · rated ${item.details.rating}` : ""}</p>}
        {item.details.note && <p className="mt-1 whitespace-pre-line text-[13px] text-body">{item.details.note}</p>}
        {error && <p className="mt-1 text-[12px] text-danger">{error}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2 empty:hidden" onClick={(e) => e.stopPropagation()}>
          {suggested && (
            <>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch({ status: "planned" })}>
                Keep
              </Button>
              <Button size="sm" variant="quiet" disabled={busy} onClick={remove}>
                Dismiss
              </Button>
            </>
          )}
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] text-accent hover:underline">
              {item.kind === "stay" ? "See prices" : "Map"} <ExternalLink size={12} aria-hidden />
            </a>
          )}
        </div>
      </div>
      {!suggested && (
        <div onClick={(e) => e.stopPropagation()} className="flex shrink-0 items-start gap-1">
          {!cancelled && item.status === "booked" && (
            <button type="button" disabled={busy} onClick={() => patch({ status: "cancelled" })} title="Mark cancelled" aria-label={`Mark ${item.title} cancelled`} className="inline-flex size-8 pointer-coarse:size-11 cursor-pointer items-center justify-center rounded-md text-ash hover:text-ink">
              <X size={14} />
            </button>
          )}
          <button type="button" disabled={busy} onClick={remove} title="Remove" aria-label={`Remove ${item.title}`} className="inline-flex size-8 pointer-coarse:size-11 cursor-pointer items-center justify-center rounded-md text-ash hover:text-danger">
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </li>
  );
}
