import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { PlaceDetails } from "@/lib/places/types";
import { errorText } from "./shared";

// Google place details, fetched once per place per visit and shared by the
// details panel, the stop cards' photos and the trip cover. Google bills each
// call, so stop cards only ask once they scroll into view.

type Entry = { place: PlaceDetails | null; error: string | null };
const cache = new Map<string, Promise<Entry>>();

export const isGoogle = (placeId: string | undefined): placeId is string => Boolean(placeId?.startsWith("g:"));

export function fetchPlace(placeId: string): Promise<Entry> {
  let hit = cache.get(placeId);
  if (!hit) {
    hit = api<{ place: PlaceDetails }>(`/api/places/details?id=${encodeURIComponent(placeId)}`)
      .then((r) => ({ place: r.place, error: null }))
      .catch((err) => ({ place: null, error: errorText(err, "Couldn't load this place.") }));
    cache.set(placeId, hit);
  }
  return hit;
}

export const photoUrl = (name: string, width = 800) => `/api/places/photo?name=${encodeURIComponent(name)}&w=${width}`;

/** The place's details once `enabled`; loading until they arrive. Non-Google places have none. */
export function usePlace(placeId: string | undefined, enabled = true): { place: PlaceDetails | null; loading: boolean; error: string | null } {
  const [state, setState] = useState<{ id: string; entry: Entry } | null>(null);
  useEffect(() => {
    if (!enabled || !isGoogle(placeId)) return;
    let alive = true;
    fetchPlace(placeId).then((entry) => alive && setState({ id: placeId, entry }));
    return () => {
      alive = false;
    };
  }, [placeId, enabled]);
  if (!isGoogle(placeId)) return { place: null, loading: false, error: null };
  if (state?.id === placeId) return { place: state.entry.place, loading: false, error: state.entry.error };
  return { place: null, loading: enabled, error: null };
}

/** True once the element has come within a screen of the viewport. */
export function useInView<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: "100% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}
