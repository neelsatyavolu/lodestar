import { ArrowLeft, CalendarDays, Pencil, Share2, Trash2, Users } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/client";
import type { Journey } from "@/lib/journeys/types";
import type { Suggestion } from "@/lib/places/types";
import { Button } from "../ui";
import { fetchPlace, photoUrl } from "./place-cache";
import { countdown, dateRange, travellers, TRIP_TYPE_LABEL } from "./shared";

// The trip's header: a wide photo of the destination with the title card
// overlapping its foot, as in Wanderlog. The photo comes from Google Places;
// without a Places key (or a match) the header is plain, never a broken image.

const COVER_KEY = (d: string) => `lodestar:cover:${d.toLowerCase()}`;

function useCover(destination: string | null): string | null {
  const [photo, setPhoto] = useState<{ for: string; name: string | null } | null>(null);
  useEffect(() => {
    if (!destination || destination.length < 2) return;
    let alive = true;
    const done = (name: string | null) => {
      try {
        sessionStorage.setItem(COVER_KEY(destination), name ?? "");
      } catch {
        /* storage off: look it up next visit */
      }
      if (alive) setPhoto({ for: destination, name });
    };
    let cached: string | null = null;
    try {
      cached = sessionStorage.getItem(COVER_KEY(destination));
    } catch {
      cached = null;
    }
    if (cached !== null) {
      Promise.resolve().then(() => alive && setPhoto({ for: destination, name: cached || null }));
    } else {
      api<{ suggestions: Suggestion[]; provider: string }>(`/api/places/search?q=${encodeURIComponent(destination)}`)
        .then(async (r) => {
          const first = r.suggestions.find((s) => s.id.startsWith("g:"));
          if (!first) return done(null);
          const { place } = await fetchPlace(first.id);
          done(place?.photos[0] ?? null);
        })
        .catch(() => done(null));
    }
    return () => {
      alive = false;
    };
  }, [destination]);
  return photo?.for === destination ? photo.name : null;
}

type Props = { journey: Journey; onBack: () => void; onEdit: () => void; onShare: () => void; onDelete: () => void; extra?: ReactNode };

export function TripCover({ journey, onBack, onEdit, onShare, onDelete, extra }: Props) {
  const photo = useCover(journey.destination);
  const [loaded, setLoaded] = useState(false);
  const when = countdown(journey);
  const meta: { icon: ReactNode; text: string }[] = [{ icon: <CalendarDays size={14} aria-hidden />, text: dateRange(journey.startDate, journey.endDate) }];
  if (journey.travelers) meta.push({ icon: <Users size={14} aria-hidden />, text: travellers(journey.travelers)! });

  const card = (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="font-display text-[clamp(30px,5vw,46px)] leading-[1.05] tracking-[-0.02em] [text-wrap:balance]">{journey.title}</h1>
        <p className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-body">
          {meta.map((m) => (
            <span key={m.text} className="tnum inline-flex items-center gap-1.5">
              <span className="text-ash">{m.icon}</span> {m.text}
            </span>
          ))}
          {journey.tripType && <span className="text-mute">{TRIP_TYPE_LABEL[journey.tripType]}</span>}
          {when && <span className="text-accent">{when}</span>}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="quiet" onClick={onEdit}>
          <Pencil size={14} /> Edit
        </Button>
        <Button size="sm" variant={journey.shareToken ? "ghost" : "quiet"} onClick={onShare}>
          <Share2 size={14} /> {journey.shareToken ? "Shared" : "Share"}
        </Button>
        <Button size="sm" variant="quiet" onClick={onDelete} aria-label="Delete trip">
          <Trash2 size={14} />
        </Button>
      </div>
      {extra && <div className="w-full">{extra}</div>}
    </div>
  );

  return (
    <header>
      <button type="button" onClick={onBack} className="inline-flex h-9 cursor-pointer items-center gap-1.5 text-[13px] text-charcoal hover:text-ink">
        <ArrowLeft size={14} /> All trips
      </button>
      {photo ? (
        <div className="mt-2">
          <div className="relative h-[200px] overflow-hidden rounded-xl bg-elevated sm:h-[260px]">
            {/* eslint-disable-next-line @next/next/no-img-element -- a redirect to Google's image host; next/image can't proxy it. */}
            <img
              src={photoUrl(photo, 1600)}
              alt={journey.destination ? `${journey.destination}` : ""}
              onLoad={() => setLoaded(true)}
              onError={(e) => (e.currentTarget.style.display = "none")}
              className={`size-full object-cover transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"}`}
            />
          </div>
          <div className="relative mx-3 -mt-14 rounded-xl border border-hairline-strong bg-card px-5 py-4 sm:mx-6 sm:px-6 sm:py-5">{card}</div>
        </div>
      ) : (
        <div className="mt-3">{card}</div>
      )}
    </header>
  );
}
