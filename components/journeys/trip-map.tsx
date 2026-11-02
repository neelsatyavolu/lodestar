import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MlMap, Marker } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { byItinerary } from "@/lib/journeys/locate";
import type { Item } from "@/lib/journeys/types";

// The trip on a map: numbered pins per day (like the itinerary), the chosen
// day's stops joined in order, and a click on a pin opening that item.
// Tiles are OpenFreeMap's (free, no key), dark or light to match the page.

const STYLE = { dark: "https://tiles.openfreemap.org/styles/dark", light: "https://tiles.openfreemap.org/styles/positron" };
const ROUTE = "day-route";

function darkMode(): boolean {
  const t = document.documentElement.getAttribute("data-theme");
  return t ? t === "dark" : !window.matchMedia("(prefers-color-scheme: light)").matches;
}

export type Pin = { item: Item; n: number };

/** Located items with their number within their day, in itinerary order. */
export function pinsOf(items: Item[]): Pin[] {
  const located = items
    .filter((i) => i.details.lat !== undefined && i.details.lng !== undefined && i.status !== "cancelled")
    .sort(byItinerary);
  const perDay = new Map<string, number>();
  return located.map((item) => {
    const n = (perDay.get(item.startDate) ?? 0) + 1;
    perDay.set(item.startDate, n);
    return { item, n };
  });
}

function pinElement(pin: Pin, state: { selected: boolean; onDay: boolean }, onClick: () => void): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", `${pin.item.title}, ${pin.item.startDate}`);
  el.textContent = pin.item.kind === "stay" ? "⌂" : pin.item.kind === "flight" ? "✈" : String(pin.n);
  const idea = pin.item.status === "suggested";
  el.style.cssText = [
    "display:flex;align-items:center;justify-content:center;border-radius:9999px;cursor:pointer;font:600 12px/1 var(--font-sans),system-ui;",
    `width:${state.selected ? 32 : 26}px;height:${state.selected ? 32 : 26}px;`,
    state.onDay || state.selected ? "background:var(--accent);color:var(--accent-on);" : "background:var(--elev);color:var(--ink);",
    idea && !state.selected ? "border:1.5px dashed var(--accent);" : `border:2px solid ${state.selected ? "var(--ink)" : "var(--canvas)"};`,
    state.onDay || state.selected ? "z-index:2;" : "opacity:0.85;",
  ].join("");
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return el;
}

/** `panelOpen`: the details panel covers the lower part of the map, so selected pins are framed above it. */
export function TripMap({ items, selectedId, day, onSelect, panelOpen = false }: { items: Item[]; selectedId: string | null; day: string | null; onSelect: (id: string) => void; panelOpen?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  const pins = pinsOf(items);
  const key = pins.map((p) => `${p.item.id}:${p.item.details.lat},${p.item.details.lng}:${p.item.status}`).join("|");

  useEffect(() => {
    let cancelled = false;
    let instance: MlMap | null = null;
    import("maplibre-gl").then(({ Map: MapClass, setWorkerUrl }) => {
      if (cancelled || !box.current) return;
      // Served from public/ (scripts/copy-maplibre-worker.mjs); the bundled path doesn't resolve.
      setWorkerUrl("/maplibre-gl-worker.mjs");
      instance = new MapClass({ container: box.current, style: darkMode() ? STYLE.dark : STYLE.light, center: [-98, 39], zoom: 2.5, attributionControl: { compact: true } });
      instance.on("load", () => {
        instance!.addSource(ROUTE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        instance!.addLayer({ id: ROUTE, type: "line", source: ROUTE, paint: { "line-color": "#4c8dff", "line-width": 3, "line-opacity": 0.85 }, layout: { "line-cap": "round", "line-join": "round" } });
        // Credits start folded behind their "i" button so they don't cover a small map.
        box.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
        map.current = instance;
        setReady(true);
      });
    });
    return () => {
      cancelled = true;
      instance?.remove();
      map.current = null;
    };
  }, []);

  // Pins: redrawn when the items, the selection or the day change.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    let alive = true;
    import("maplibre-gl").then(({ Marker: MarkerClass, LngLatBounds }) => {
      if (!alive) return;
      markers.current.forEach((mk) => mk.remove());
      markers.current = pins.map((pin) =>
        new MarkerClass({ element: pinElement(pin, { selected: pin.item.id === selectedId, onDay: pin.item.startDate === day }, () => onSelect(pin.item.id)) })
          .setLngLat([pin.item.details.lng!, pin.item.details.lat!])
          .addTo(m),
      );
      const stops = pins.filter((p) => p.item.startDate === day && p.item.status !== "suggested" && p.item.kind !== "flight");
      (m.getSource(ROUTE) as GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: stops.length > 1 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: stops.map((p) => [p.item.details.lng!, p.item.details.lat!]) } }] : [],
      });
      // Frame the whole trip once, then follow the chosen day or item.
      const focus = selectedId ? pins.filter((p) => p.item.id === selectedId) : day && !fitted.current ? pins : day ? pins.filter((p) => p.item.startDate === day) : pins;
      const target = focus.length ? focus : pins;
      if (!target.length) return;
      const bottom = panelOpen && selectedId ? Math.round(m.getContainer().clientHeight * 0.6) : 0;
      if (target.length === 1) m.flyTo({ center: [target[0].item.details.lng!, target[0].item.details.lat!], zoom: Math.max(m.getZoom(), 13), duration: 600, padding: { top: 0, left: 0, right: 0, bottom } });
      else {
        const bounds = new LngLatBounds();
        target.forEach((p) => bounds.extend([p.item.details.lng!, p.item.details.lat!]));
        m.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: fitted.current ? 600 : 0 });
      }
      fitted.current = true;
    });
    return () => {
      alive = false;
    };
    // `pins` is derived from `key`; onSelect is stable enough for markers rebuilt on change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key, selectedId, day, panelOpen]);

  return <div ref={box} className="h-full w-full" aria-label="Trip map" role="region" />;
}
