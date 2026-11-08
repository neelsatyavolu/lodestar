import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MlMap, Marker } from "maplibre-gl";
import { distanceKm } from "@/lib/airports";
import { useEffect, useRef, useState } from "react";
import type { Item } from "@/lib/journeys/types";
import { dayColor, pinsOf, type Pin } from "./pins";

// The trip on a map: pins coloured by day and numbered as in the itinerary,
// the chosen day's stops joined in order, and a click on a pin opening that
// item. Tiles are OpenFreeMap's "liberty" style (free, no key), which shows
// streets, parks, water and points of interest the way Google Maps does; in
// dark mode the tiles are inverted rather than swapped for a dim dark style.

const STYLE = "https://tiles.openfreemap.org/styles/liberty";
const ROUTE = "day-route";
/** Pins closer than this on screen would hide each other. */
const CROWD_PX = 22;
/** Pins this close on the ground are one spot (two plans at one hotel): fanned out, never merged. */
const SAME_SPOT_KM = 0.03;

type Placed = { marker: Marker; lng: number; lat: number; keep: boolean };
type MarkerCtor = typeof Marker;

function darkMode(): boolean {
  const t = document.documentElement.getAttribute("data-theme");
  return t ? t === "dark" : !window.matchMedia("(prefers-color-scheme: light)").matches;
}

const svg = (body: string) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const BED = svg('<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>');
const PLANE = svg('<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>');

function pinElement(pin: Pin, state: { selected: boolean; onDay: boolean }, onClick: () => void): HTMLElement {
  const { item, color } = pin;
  const idea = item.status === "suggested";
  const size = state.selected ? 34 : state.onDay ? 28 : 22;
  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", `${item.title}, ${item.startDate}`);
  el.title = item.title;
  el.innerHTML = item.kind === "stay" ? BED : item.kind === "flight" ? PLANE : `<span>${pin.n}</span>`;
  el.style.cssText = [
    "display:flex;align-items:center;justify-content:center;border-radius:9999px;cursor:pointer;padding:0;",
    `font:700 ${state.onDay || state.selected ? 13 : 11}px/1 var(--font-sans),system-ui;`,
    `width:${size}px;height:${size}px;background:${idea ? "#ffffff" : color.fill};color:${idea ? color.fill : color.ink};`,
    idea ? `border:2px dashed ${color.fill};` : `border:2px solid ${state.selected ? "#111111" : "#ffffff"};`,
    "box-shadow:0 1px 4px rgba(0,0,0,0.45);transition:width 120ms,height 120ms;",
    state.selected ? "z-index:3;" : state.onDay ? "z-index:2;" : "opacity:0.8;z-index:1;",
  ].join("");
  if (state.selected) {
    // The selected stop's name beside its pin, so you can tell which one is open.
    const label = document.createElement("span");
    label.textContent = item.title;
    label.style.cssText =
      "position:absolute;left:calc(100% + 6px);top:50%;transform:translateY(-50%);white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis;padding:3px 8px;border-radius:6px;background:#111111;color:#ffffff;font:600 12px/1.3 var(--font-sans),system-ui;box-shadow:0 1px 4px rgba(0,0,0,0.4);pointer-events:none;";
    el.style.position = "relative";
    el.appendChild(label);
  }
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return el;
}

function clusterElement(count: number, onClick: () => void): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = String(count);
  el.title = `${count} stops`;
  el.setAttribute("aria-label", `${count} stops close together. Zoom in`);
  el.style.cssText = [
    "display:flex;align-items:center;justify-content:center;border-radius:9999px;cursor:pointer;padding:0;",
    "font:700 13px/1 var(--font-sans),system-ui;width:34px;height:34px;background:#111111;color:#ffffff;",
    "border:2px solid #ffffff;box-shadow:0 1px 4px rgba(0,0,0,0.45);z-index:2;",
  ].join("");
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return el;
}

const sameSpot = (a: Placed, b: Placed) => distanceKm({ lat: a.lat, lon: a.lng }, { lat: b.lat, lon: b.lng }) < SAME_SPOT_KM;

/**
 * Keeps pins from hiding each other at the current zoom. Pins on one spot fan out in a small
 * ring; different places that crowd together zoomed out become one bubble with their count,
 * which zooms in to them. The open item's pin always shows on its own.
 */
function spread(m: MlMap, placed: Placed[], MarkerClass: MarkerCtor, bubbles: Marker[]): Marker[] {
  bubbles.forEach((b) => b.remove());
  const pts = placed.map((p) => ({ ...p, at: m.project([p.lng, p.lat]) }));
  // First the spots: pins at one place, whatever the zoom.
  const spots: (typeof pts)[] = [];
  for (const p of pts) {
    const s = spots.find((grp) => sameSpot(grp[0], p));
    if (s) s.push(p);
    else spots.push([p]);
  }
  // Then spots that crowd each other on screen.
  const crowds: (typeof spots)[] = [];
  for (const s of spots) {
    const c = s.some((p) => p.keep) ? undefined : crowds.find((grp) => !grp[0].some((p) => p.keep) && Math.hypot(grp[0][0].at.x - s[0].at.x, grp[0][0].at.y - s[0].at.y) < CROWD_PX);
    if (c) c.push(s);
    else crowds.push([s]);
  }
  const next: Marker[] = [];
  for (const crowd of crowds) {
    const members = crowd.flat();
    if (crowd.length > 1) {
      members.forEach((p) => (p.marker.getElement().style.visibility = "hidden"));
      const lng = members.reduce((t, p) => t + p.lng, 0) / members.length;
      const lat = members.reduce((t, p) => t + p.lat, 0) / members.length;
      const zoomIn = () => {
        const xs = members.map((p) => p.lng);
        const ys = members.map((p) => p.lat);
        m.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 70, maxZoom: 16, duration: 600 });
      };
      next.push(new MarkerClass({ element: clusterElement(members.length, zoomIn) }).setLngLat([lng, lat]).addTo(m));
      continue;
    }
    const [spot] = crowd;
    const r = spot.length > 1 ? 12 + spot.length * 2 : 0;
    spot.forEach((p, i) => {
      const a = (2 * Math.PI * i) / spot.length - Math.PI / 2;
      p.marker.getElement().style.visibility = "";
      p.marker.setOffset(spot.length > 1 ? [Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a))] : [0, 0]);
    });
  }
  return next;
}

/** `panelOpen`: the details panel covers the lower part of the map, so selected pins are framed above it. */
export function TripMap({ items, selectedId, day, onSelect, panelOpen = false }: { items: Item[]; selectedId: string | null; day: string | null; onSelect: (id: string) => void; panelOpen?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const placed = useRef<Placed[]>([]);
  const bubbles = useRef<Marker[]>([]);
  const markerClass = useRef<MarkerCtor | null>(null);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  const [dark, setDark] = useState(false);
  const pins = pinsOf(items);
  const key = pins.map((p) => `${p.item.id}:${p.item.details.lat},${p.item.details.lng}:${p.item.status}:${p.n}`).join("|");

  useEffect(() => {
    let cancelled = false;
    let instance: MlMap | null = null;
    import("maplibre-gl").then(({ Map: MapClass, NavigationControl, setWorkerUrl }) => {
      if (cancelled || !box.current) return;
      // Served from public/ (scripts/copy-maplibre-worker.mjs); the bundled path doesn't resolve.
      setWorkerUrl("/maplibre-gl-worker.mjs");
      setDark(darkMode());
      instance = new MapClass({ container: box.current, style: STYLE, center: [-98, 39], zoom: 2.5, attributionControl: { compact: true } });
      instance.addControl(new NavigationControl({ showCompass: false }), "top-right");
      // An icon the style names but its sprite lacks: draw nothing rather than warn.
      instance.on("styleimagemissing", (e) => instance!.hasImage(e.id) || instance!.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) }));
      instance.on("load", () => {
        instance!.addSource(ROUTE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        instance!.addLayer({ id: `${ROUTE}-casing`, type: "line", source: ROUTE, paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.9 }, layout: { "line-cap": "round", "line-join": "round" } });
        instance!.addLayer({ id: ROUTE, type: "line", source: ROUTE, paint: { "line-color": "#4c8dff", "line-width": 3.5 }, layout: { "line-cap": "round", "line-join": "round" } });
        // Credits start folded behind their "i" button so they don't cover a small map.
        box.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
        map.current = instance;
        setReady(true);
      });
      instance.on("zoomend", () => markerClass.current && (bubbles.current = spread(instance!, placed.current, markerClass.current, bubbles.current)));
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
      markerClass.current = MarkerClass;
      placed.current.forEach((p) => p.marker.remove());
      placed.current = pins.map((pin) => {
        const lng = pin.item.details.lng!;
        const lat = pin.item.details.lat!;
        const marker = new MarkerClass({ element: pinElement(pin, { selected: pin.item.id === selectedId, onDay: pin.item.startDate === day }, () => onSelect(pin.item.id)) }).setLngLat([lng, lat]).addTo(m);
        return { marker, lng, lat, keep: pin.item.id === selectedId };
      });
      const stops = pins.filter((p) => p.item.startDate === day && p.item.status !== "suggested" && p.item.kind !== "flight");
      if (day) m.setPaintProperty(ROUTE, "line-color", dayColor(items, day).fill);
      (m.getSource(ROUTE) as GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: stops.length > 1 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: stops.map((p) => [p.item.details.lng!, p.item.details.lat!]) } }] : [],
      });
      // Frame the whole trip once, then follow the chosen day or item. Flights don't count
      // unless there's nothing else: the flight home would zoom out to half the world.
      const places = pins.filter((p) => p.item.kind !== "flight");
      const trip = places.length ? places : pins.slice(0, 1);
      const focus = selectedId ? pins.filter((p) => p.item.id === selectedId) : day && fitted.current ? places.filter((p) => p.item.startDate === day) : trip;
      const target = focus.length ? focus : trip;
      if (!target.length) return;
      const bottom = panelOpen && selectedId ? Math.round(m.getContainer().clientHeight * 0.6) : 0;
      if (target.length === 1) m.flyTo({ center: [target[0].item.details.lng!, target[0].item.details.lat!], zoom: Math.max(m.getZoom(), 13), duration: 600, padding: { top: 0, left: 0, right: 0, bottom } });
      else {
        const bounds = new LngLatBounds();
        target.forEach((p) => bounds.extend([p.item.details.lng!, p.item.details.lat!]));
        m.fitBounds(bounds, { padding: 70, maxZoom: 14, duration: fitted.current ? 600 : 0 });
      }
      fitted.current = true;
      bubbles.current = spread(m, placed.current, MarkerClass, bubbles.current);
    });
    return () => {
      alive = false;
    };
    // `pins` is derived from `key`; onSelect is stable enough for markers rebuilt on change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key, selectedId, day, panelOpen]);

  // Dark mode inverts the map's canvas only; pins and controls keep their colours. `contain: paint`
  // clips pins and bubbles off the map's edge in every browser; overflow alone let them draw over the page.
  return <div ref={box} className={`h-full w-full overflow-hidden [contain:paint] ${dark ? "[&_canvas]:[filter:invert(0.92)_hue-rotate(180deg)_saturate(0.7)_brightness(0.95)]" : ""}`} aria-label="Trip map" role="region" />;
}
