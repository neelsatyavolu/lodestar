import { ArrowUpRight, Check, Minus, X } from "lucide-react";
import { useState } from "react";
import { money } from "@/lib/format";
import { TIER_LABEL } from "@/lib/sellers";
import type { FarePolicy } from "@/lib/types";
import type { Verified, VerifiedSeller } from "@/lib/verify";
import { Logo } from "./logo";
import { Pill, StatusDot } from "./ui";

function PolicyChip({ ok, label }: { ok: boolean | null; label: string }) {
  const Icon = ok === null ? Minus : ok ? Check : X;
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${ok === null ? "text-ash" : ok ? "text-body" : "text-mute line-through decoration-stone"}`}>
      <Icon size={12} className={ok ? "text-ink" : "text-ash"} />
      {label}
    </span>
  );
}

function bagChip(p: FarePolicy): { ok: boolean | null; label: string } {
  if (p.checked_bag_fee === 0) return { ok: true, label: "Checked bag included" };
  if (p.checked_bag_fee) return { ok: null, label: `Checked bag $${p.checked_bag_fee}` };
  if (p.checked_bag_included === false) return { ok: false, label: "No checked bag" };
  return { ok: null, label: "Checked bag" };
}

function policyChips(p: FarePolicy) {
  return [
    { ok: p.carry_on, label: "Carry-on" },
    bagChip(p),
    { ok: p.changes === null || p.changes === "fee" ? null : p.changes === "free", label: p.changes === "fee" ? "Changes for a fee" : p.changes === "free" ? "Free changes" : "Changes" },
    { ok: p.refunds === null ? null : p.refunds !== "none", label: p.refunds === "full" ? "Refundable" : p.refunds === "partial" ? "Partly refundable" : "Refunds" },
    { ok: p.seat_selection === null || p.seat_selection === "fee" ? null : p.seat_selection === "free", label: p.seat_selection === "free" ? "Seat choice" : p.seat_selection === "fee" ? "Seat choice for a fee" : "Seat choice" },
  ];
}

const TIER_DOT = { airline: "ok", trusted: "ok", unvetted: "warn" } as const;

function SellerRow({ seller, bookingUrl }: { seller: VerifiedSeller; bookingUrl: string }) {
  const tiers = seller.fares.length > 1 || seller.fares[0]?.name;
  return (
    <div className="border-t border-hairline py-3 first:border-t-0">
      <div className="flex items-center gap-3">
        <Logo src={seller.logo} name={seller.name} size={28} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-ink">{seller.name}</div>
          <Pill dot={TIER_DOT[seller.tier]} className="mt-0.5 !bg-transparent !px-0 !py-0 text-[11px] !text-charcoal">
            {TIER_LABEL[seller.tier]}
          </Pill>
        </div>
        <div className="text-right">
          <div className="text-[15px] text-ink tnum">{money(seller.lowest)}</div>
          {tiers && <div className="text-[11px] text-ash">from</div>}
        </div>
        <a
          href={bookingUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={`Opens this exact itinerary on Google Flights, where you continue to ${seller.name}`}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-hairline-strong bg-elevated px-3 text-[13px] text-ink hover:border-hairline-hover max-sm:h-10"
        >
          Book <ArrowUpRight size={13} />
        </a>
      </div>
      {tiers && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {seller.fares.map((f) => (
            <div key={`${f.name}-${f.price}`} className="rounded-md border border-hairline bg-deep p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[13px] text-ink">{f.name ?? "Standard"}</span>
                <span className="text-[13px] text-ink tnum">{money(f.price)}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                {policyChips(f.policy).map((c) => (
                  <PolicyChip key={c.label} {...c} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Insight({ insight }: { insight: Verified["insight"] }) {
  if (!insight.level && !insight.summary) return null;
  const state = insight.level === "low" ? "ok" : insight.level === "high" ? "danger" : "warn";
  return (
    <div className="flex gap-3 rounded-md border border-hairline bg-deep p-3">
      <StatusDot state={state} className="mt-1.5" />
      <div className="text-[13px] leading-relaxed text-body">
        {insight.level && (
          <span className="text-ink">
            Price is {insight.level}
            {insight.cheaper_than_usual_by ? `, $${insight.cheaper_than_usual_by} under usual` : ""}.{" "}
          </span>
        )}
        {insight.typical_low && insight.typical_high && <>Similar trips usually cost {money(insight.typical_low)}–{money(insight.typical_high)}. </>}
        {insight.unlikely_to_drop_below && <>Google expects it won&apos;t drop below {money(insight.unlikely_to_drop_below)}, so waiting is unlikely to help.</>}
      </div>
    </div>
  );
}

export function SellersPanel({ verified, trustedOnly }: { verified: Verified; trustedOnly: boolean }) {
  const [showAll, setShowAll] = useState(!trustedOnly);
  const hidden = verified.sellers.filter((s) => s.tier === "unvetted");
  const shown = showAll ? verified.sellers : verified.sellers.filter((s) => s.tier !== "unvetted");
  return (
    <div className="space-y-3">
      <Insight insight={verified.insight} />
      <div>
        {shown.map((s) => (
          <SellerRow key={s.name} seller={s} bookingUrl={verified.bookingUrl} />
        ))}
        {!shown.length && <p className="py-3 text-sm text-mute">No airline or trusted agency sells this itinerary. Only unvetted agencies list it.</p>}
      </div>
      {hidden.length > 0 && (
        <button type="button" onClick={() => setShowAll(!showAll)} className="cursor-pointer text-[13px] text-accent hover:underline">
          {showAll ? "Hide unvetted agencies" : `Show ${hidden.length} unvetted agenc${hidden.length === 1 ? "y" : "ies"}`}
          {!showAll && verified.unvettedGap > 0 && <span className="text-ash"> (from {money(verified.lowestAny)}, ${Math.round(verified.unvettedGap)} less)</span>}
        </button>
      )}
    </div>
  );
}
