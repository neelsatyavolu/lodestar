import { ArrowUpRight, ChevronDown, Star } from "lucide-react";
import { useState } from "react";
import { day, money } from "@/lib/format";
import type { FlexSaving } from "@/lib/stays/flex";
import { refundable, STAY_TIER_LABEL, type VerifiedOffer } from "@/lib/stays/offers";
import type { Hotel } from "@/lib/stays/types";
import { Logo } from "./logo";
import { Button, Pill } from "./ui";

// One hotel from a Stays search: Google's "from" price, a cheaper-dates hint,
// and on opening, every seller's price with taxes and which of them we trust.

export type OfferCheck = { state: "loading" } | { state: "done"; offers: VerifiedOffer[]; url: string } | { state: "error"; error: string };

const TIER_DOT = { airline: "ok", trusted: "ok", unvetted: "warn" } as const;

function OfferRow({ offer, nights }: { offer: VerifiedOffer; nights: number }) {
  return (
    <div className="flex items-center gap-3 border-t border-hairline py-3 first:border-t-0">
      <Logo src={offer.logo} name={offer.seller} size={28} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-ink">{offer.seller}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
          <Pill dot={TIER_DOT[offer.tier]} className="!bg-transparent !px-0 !py-0 text-[12px] !text-charcoal">
            {STAY_TIER_LABEL[offer.tier]}
          </Pill>
          {offer.free_cancel_until && <span className="text-body">Free cancellation until {day(offer.free_cancel_until)}</span>}
        </div>
      </div>
      <div className="text-right tnum">
        <div className="text-[15px] text-ink">{money(offer.total)}</div>
        <div className="text-[12px] text-ash">
          {money(offer.nightly)} × {nights} nights
        </div>
      </div>
      {offer.url && (
        <a
          href={offer.url}
          target="_blank"
          rel="noopener noreferrer"
          title={`Continue to ${offer.seller} through Google Hotels`}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-hairline-strong bg-elevated px-3 text-[13px] text-ink hover:border-hairline-hover pointer-coarse:h-11"
        >
          Book <ArrowUpRight size={13} />
        </a>
      )}
    </div>
  );
}

function RefundableNote({ offers, nights }: { offers: VerifiedOffer[]; nights: number }) {
  const r = refundable(offers, nights);
  if (r.kind === "none") return <p className="text-[13px] text-mute">None of these rates can be cancelled for free.</p>;
  if (r.kind === "included") return <p className="text-[13px] text-body">The cheapest rate here can be cancelled for free until {day(r.offer.free_cancel_until!)}.</p>;
  return (
    <p className="text-[13px] text-body">
      <span className="text-ink">Refundable for {money(r.extra)} more</span> ({money(r.perNight)} a night) with {r.offer.seller}, free to cancel until {day(r.offer.free_cancel_until!)}.
    </p>
  );
}

function OffersPanel({ check, nights, trustedOnly, onRetry }: { check: OfferCheck; nights: number; trustedOnly: boolean; onRetry: () => void }) {
  const [showAll, setShowAll] = useState(!trustedOnly);
  if (check.state === "loading") {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-12 rounded-md" />
        ))}
        <p className="text-xs text-ash">Reading every seller&apos;s price for these dates…</p>
      </div>
    );
  }
  if (check.state === "error") {
    return (
      <div className="space-y-2 text-sm text-mute">
        <p>{check.error}</p>
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  const hidden = check.offers.filter((o) => o.tier === "unvetted");
  const shown = showAll ? check.offers : check.offers.filter((o) => o.tier !== "unvetted");
  const cheapestHidden = hidden[0] && shown[0] ? shown[0].total - hidden[0].total : 0;
  return (
    <div className="space-y-3">
      <RefundableNote offers={shown} nights={nights} />
      <div>
        {shown.map((o) => (
          <OfferRow key={`${o.seller}-${o.total}-${o.free_cancel_until}`} offer={o} nights={nights} />
        ))}
        {!shown.length && <p className="py-3 text-sm text-mute">Only agencies we haven&apos;t vetted list this hotel for these dates.</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        {hidden.length > 0 && (
          <button type="button" onClick={() => setShowAll(!showAll)} className="cursor-pointer text-[13px] text-accent hover:underline">
            {showAll ? "Hide unvetted agencies" : `Show ${hidden.length} unvetted agenc${hidden.length === 1 ? "y" : "ies"}`}
            {!showAll && cheapestHidden > 0 && <span className="text-ash"> (from {money(hidden[0].total)}, {money(cheapestHidden)} less)</span>}
          </button>
        )}
        <a href={check.url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-[13px] text-mute hover:text-ink">
          Open on Google Hotels <ArrowUpRight size={12} />
        </a>
      </div>
    </div>
  );
}

export function StayCard({
  hotel,
  nights,
  check,
  onCheck,
  saving,
  onShift,
  trustedOnly,
}: {
  hotel: Hotel;
  nights: number;
  check?: OfferCheck;
  onCheck: () => void;
  saving?: FlexSaving;
  onShift: (s: FlexSaving) => void;
  trustedOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const toggle = () => {
    if (!open && !check) onCheck();
    setOpen(!open);
  };
  return (
    <article className="overflow-hidden rounded-lg border border-hairline-strong bg-card hover:border-hairline-hover">
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full cursor-pointer gap-4 p-3 text-left sm:p-4">
        {hotel.image && !imageFailed ? (
          // Google's thumbnails; next/image would need their host allow-listed for no gain at this size.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={hotel.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} className="h-16 w-20 shrink-0 rounded-md bg-elevated object-cover sm:h-24 sm:w-36" />
        ) : (
          <span className="h-16 w-20 shrink-0 rounded-md bg-elevated sm:h-24 sm:w-36" />
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <h3 className="text-[15px] font-medium leading-snug text-ink">{hotel.name}</h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-mute">
            {hotel.rating !== null && (
              <span className="inline-flex items-center gap-1 text-body">
                <Star size={12} className="fill-current text-ink" />
                {hotel.rating.toFixed(1)}
                {hotel.reviews !== null && <span className="text-ash">({hotel.reviews.toLocaleString("en-US")})</span>}
              </span>
            )}
            {hotel.stars !== null && <span>{hotel.stars}-star</span>}
            {hotel.deal_pct !== null && <span className="text-ok">{hotel.deal_pct}% under usual</span>}
          </div>
          {hotel.amenities.length > 0 && <p className="truncate text-xs text-ash">{hotel.amenities.slice(0, 4).join(" · ")}</p>}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[12px] text-ash">from</div>
          <div className="text-xl text-ink tnum">{money(hotel.price)}</div>
          <div className="text-[12px] text-ash">
            a night<span className="max-sm:hidden">, before taxes</span>
          </div>
        </div>
        <ChevronDown size={16} className={`mt-1 shrink-0 text-ash transition-transform max-sm:hidden ${open ? "rotate-180" : ""}`} />
      </button>
      {saving && (
        <div className="-mt-1 px-3 pb-3 sm:px-4">
          <button type="button" onClick={() => onShift(saving)} className="cursor-pointer text-left text-xs text-accent hover:underline">
            About {money(saving.saving)} less arriving {saving.shift === "earlier" ? "a night earlier" : "a night later"} ({day(saving.checkin)} – {day(saving.checkout)}). Search those dates
          </button>
        </div>
      )}
      {open && (
        <div className="border-t border-hairline p-4">
          <div className="mb-2 text-xs text-ash">Who sells this stay, with taxes and fees</div>
          {check ? <OffersPanel check={check} nights={nights} trustedOnly={trustedOnly} onRetry={onCheck} /> : null}
        </div>
      )}
    </article>
  );
}
