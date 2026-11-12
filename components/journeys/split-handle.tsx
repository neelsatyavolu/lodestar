import { useState, useSyncExternalStore, type PointerEvent } from "react";

// The divider between the plan and the map on wide screens: drag it to give
// either side more room. The width is remembered in this browser.

const KEY = "lodestar:map-width";
const MIN_MAP = 320;
const MIN_PLAN = 520;

const readStored = () => {
  try {
    const n = Number(localStorage.getItem(KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
};
const noSubscribe = () => () => {};

const clamp = (w: number) => Math.round(Math.min(Math.max(w, MIN_MAP), window.innerWidth - MIN_PLAN));

/** The map's width in pixels once someone has dragged it, else null (the layout's default). */
export function useMapWidth(): [number | null, (w: number) => void] {
  const stored = useSyncExternalStore(noSubscribe, readStored, () => null);
  const [dragged, setDragged] = useState<number | null>(null);
  const set = (w: number) => {
    const next = clamp(w);
    setDragged(next);
    try {
      localStorage.setItem(KEY, String(next));
    } catch {
      // Storage blocked: the width lasts until the page reloads.
    }
  };
  return [dragged ?? stored, set];
}

export function SplitHandle({ onWidth }: { onWidth: (w: number) => void }) {
  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: globalThis.PointerEvent) => onWidth(window.innerWidth - ev.clientX);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  const key = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 80 : 24;
    const now = window.innerWidth - (e.currentTarget.parentElement?.getBoundingClientRect().left ?? 0);
    if (e.key === "ArrowLeft") onWidth(now + step);
    if (e.key === "ArrowRight") onWidth(now - step);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the map"
      tabIndex={0}
      onPointerDown={down}
      onKeyDown={key}
      className="group absolute inset-y-0 left-0 z-20 w-2 cursor-col-resize touch-none outline-none"
    >
      <span className="absolute inset-y-0 left-0 w-px bg-hairline transition-colors duration-150 group-hover:w-0.5 group-hover:bg-accent group-focus-visible:w-0.5 group-focus-visible:bg-accent" aria-hidden />
    </div>
  );
}
