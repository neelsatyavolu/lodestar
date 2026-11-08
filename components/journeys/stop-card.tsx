import { BedDouble, Car, ExternalLink, Footprints, Plane, StickyNote, Ticket, TrainFront, Trash2, UtensilsCrossed } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/client";
import type { Item } from "@/lib/journeys/types";
import { legLabel, type Leg } from "@/lib/places/types";
import { Button, Pill } from "../ui";
import { MoreMenu, type MenuItem } from "./collapsible";
import { photoUrl, useInView, usePlace } from "./place-cache";
import type { Pin } from "./pins";
import { deadline, errorText, patchItem, shortDate, time12, timeRange } from "./shared";
import { askConfirm } from "../confirm";

// The itinerary's building blocks: a stop (numbered pin, name, time, note,
// photo), a free-text note, the night's stay, and the drive to the next stop.

const KIND_ICON = { stay: BedDouble, flight: Plane, dining: UtensilsCrossed, activity: Ticket, transport: TrainFront, note: StickyNote } as const;

/** A map-pin teardrop in the day's colour with the stop's number; grey with the kind's icon when it isn't on the map. */
export function Teardrop({ pin, kind, dashed = false }: { pin?: Pin; kind: Item["kind"]; dashed?: boolean }) {
  const fill = pin?.color.fill ?? "var(--stone)";
  const ink = pin?.color.ink ?? "var(--ink)";
  const Icon = kind === "stay" || kind === "flight" || !pin ? KIND_ICON[kind] : null;
  return (
    <span className="relative inline-flex h-[30px] w-6 shrink-0 justify-center" aria-hidden title={pin ? undefined : "Not on the map yet"}>
      <svg viewBox="0 0 24 30" className="absolute inset-0 size-full">
        <path d="M12 29C12 29 22.5 18.6 22.5 11.5C22.5 5.7 17.8 1 12 1S1.5 5.7 1.5 11.5C1.5 18.6 12 29 12 29Z" fill={dashed ? "none" : fill} stroke={fill} strokeWidth={dashed ? 1.5 : 0} strokeDasharray={dashed ? "3 2" : undefined} />
      </svg>
      <span className="relative mt-[5px] text-[11px] font-bold leading-none" style={{ color: dashed ? fill : ink }}>
        {Icon ? <Icon size={11} /> : pin?.n}
      </span>
    </span>
  );
}

function statusPill(i: Item) {
  if (i.status === "booked") return <Pill dot="ok">Booked</Pill>;
  if (i.status === "cancelled") return <Pill dot="danger">Cancelled</Pill>;
  if (i.status === "suggested") return <Pill tone="accent">Idea</Pill>;
  if (i.details.reserve) {
    const due = deadline(i.details.bookBy);
    return <Pill dot={due?.tone ?? "warn"}>To book{i.details.bookBy ? ` · by ${shortDate(i.details.bookBy)}` : ""}</Pill>;
  }
  return null;
}

type StopProps = { item: Item; pin?: Pin; selected: boolean; onOpen: () => void; onChanged: (i: Item) => void; onRemoved: () => void };

export function StopCard({ item, pin, selected, onOpen, onChanged, onRemoved }: StopProps) {
  const [ref, seen] = useInView<HTMLLIElement>();
  const { place } = usePlace(item.details.placeId, seen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suggested = item.status === "suggested";
  const cancelled = item.status === "cancelled";
  const when = timeRange(item);
  const sub = [place?.category ?? item.details.cuisine, item.kind === "flight" ? null : (item.details.address ?? item.place), item.confirmation ? `Conf. ${item.confirmation}` : null].filter(Boolean).join(" · ");
  const photo = place?.photos[0];

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await patchItem(item.id, body));
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

  const menu: MenuItem[] = [
    ...(item.status === "planned" && !item.details.reserve ? [{ label: "Needs booking", onSelect: () => patch({ facts: { reserve: true } }) }] : []),
    ...(item.status === "planned" && item.details.reserve ? [{ label: "Doesn't need booking", onSelect: () => patch({ facts: { reserve: null, bookBy: null } }) }] : []),
    ...(item.status === "planned" ? [{ label: "Mark booked", onSelect: () => patch({ status: "booked" }) }] : []),
    ...(item.status === "booked" ? [{ label: "Mark cancelled", onSelect: () => patch({ status: "cancelled" }) }] : []),
    { label: "Remove", onSelect: remove, danger: true },
  ];

  return (
    <li
      ref={ref}
      onClick={onOpen}
      className={`group relative flex cursor-pointer gap-3 rounded-xl border px-3 py-3 transition-colors duration-150 sm:px-4 ${selected ? "border-hairline-hover bg-elevated" : suggested ? "border-dashed border-hairline-strong hover:bg-hover" : "border-hairline-strong bg-card hover:border-hairline-hover"}`}
    >
      <Teardrop pin={pin} kind={item.kind} dashed={suggested} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <button type="button" onClick={(e) => (e.stopPropagation(), onOpen())} className={`cursor-pointer text-left text-[15px] font-semibold leading-snug hover:underline ${cancelled ? "text-ash line-through" : "text-ink"}`}>
            {item.title}
          </button>
          {statusPill(item)}
        </div>
        {sub && <p className="mt-0.5 truncate text-[13px] text-mute">{sub}</p>}
        {(item.details.note || item.details.why) && <p className="mt-1.5 max-w-[60ch] whitespace-pre-line text-[15px] leading-relaxed text-body [text-wrap:pretty]">{item.details.note ?? item.details.why}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2 empty:hidden" onClick={(e) => e.stopPropagation()}>
          {when && <span className="tnum inline-flex h-6 items-center rounded-full bg-elevated px-2.5 text-[12px] text-charcoal">{when}</span>}
          {item.kind === "flight" && item.endTime && <span className="text-[12px] text-mute">{item.details.from && item.details.to ? `${item.details.from} → ${item.details.to}` : null}</span>}
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
          {item.details.url && item.kind === "stay" && suggested && (
            <a href={item.details.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] text-accent hover:underline">
              See prices <ExternalLink size={12} aria-hidden />
            </a>
          )}
        </div>
        {error && <p className="mt-1 text-[12px] text-danger">{error}</p>}
      </div>
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element -- a redirect to Google's image host; next/image can't proxy it.
        <img src={photoUrl(photo, 320)} alt="" loading="lazy" className="hidden aspect-[4/3] w-28 shrink-0 self-start rounded-lg bg-elevated object-cover outline outline-1 -outline-offset-1 outline-hairline-strong sm:block" />
      )}
      {!suggested && (
        <div onClick={(e) => e.stopPropagation()} className="-mr-1.5 -mt-1 shrink-0 self-start">
          <MoreMenu items={menu} label={`Actions for ${item.title}`} />
        </div>
      )}
    </li>
  );
}

/** Free text in a day: a drive, a tip, free time. It sits between stops by its time and isn't one itself, so the drive between them still shows. */
export function NoteCard({ item, onOpen, onRemoved }: { item: Item; onOpen: () => void; onRemoved: () => void }) {
  const when = timeRange(item);
  return (
    <li onClick={onOpen} className="group flex cursor-pointer gap-3 rounded-xl bg-elevated px-3 py-3 sm:px-4">
      <StickyNote size={16} className="mt-0.5 shrink-0 text-ash" aria-hidden />
      <div className="min-w-0 flex-1 text-[15px] leading-relaxed">
        <p className="text-ink">
          {when && <span className="tnum mr-2 text-[13px] text-mute">{when}</span>}
          {item.title}
        </p>
        {item.details.note && <p className="max-w-[60ch] whitespace-pre-line text-body [text-wrap:pretty]">{item.details.note}</p>}
      </div>
      <button
        type="button"
        onClick={async (e) => {
          e.stopPropagation();
          if (!(await askConfirm("Delete this note?", "Delete note", item.title))) return;
          await api(`/api/journeys/items/${item.id}`, { method: "DELETE" }).then(onRemoved, () => {});
        }}
        aria-label={`Remove note: ${item.title}`}
        className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-ash hover:text-danger"
      >
        <Trash2 size={14} />
      </button>
    </li>
  );
}

/** The night's stay at the top of a day, marked when you check in or out that day. */
export function StayRow({ stay, date, onOpen }: { stay: Item; date: string; onOpen: () => void }) {
  const label = stay.startDate === date ? `Check in${stay.startTime ? ` ${time12(stay.startTime)}` : ""}` : stay.endDate === date ? `Check out${stay.endTime ? ` ${time12(stay.endTime)}` : ""}` : null;
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-1 py-1.5 text-left hover:bg-hover">
        <BedDouble size={16} className="shrink-0 text-charcoal" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[14px] text-body">{stay.title}</span>
        {label && <span className="shrink-0 text-[12px] text-mute">{label}</span>}
      </button>
    </li>
  );
}

/** "7 min · 2.8 mi" with a car, or a walker under a kilometre. */
export function LegRow({ leg, directions }: { leg: Leg | undefined | null; directions: string }) {
  const Icon = leg && leg.meters < 1000 ? Footprints : Car;
  return (
    <li className="flex items-center gap-2 py-1 pl-[11px] text-[12px] text-mute sm:pl-[15px]">
      <span className="h-6 border-l border-dashed border-hairline-hover" aria-hidden />
      <Icon size={14} className="ml-4 shrink-0 text-ash" aria-hidden />
      {leg && <span className="tnum">{legLabel(leg)}</span>}
      <a href={directions} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-charcoal hover:text-ink">
        Directions <ExternalLink size={11} aria-hidden />
      </a>
    </li>
  );
}
