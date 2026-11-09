import { useEffect, useState } from "react";
import { Button } from "./ui";

// A short walkthrough after sign-up: dims the page, outlines one element at a
// time and explains it in a card underneath. Steps whose element is hidden
// (for example on a phone) are skipped.

/** `before` runs when the step opens, e.g. to switch to the view its element is in. */
export type TourStep = { target: string; title: string; body: string; before?: () => void };

const CARD_WIDTH = 320;
const GUTTER = 16;
const GAP = 12;
const PAD = 6;

const isVisible = (selector: string) => {
  const el = document.querySelector(selector);
  return Boolean(el && el.getBoundingClientRect().width > 0);
};

export function Tour({ steps, onDone }: { steps: TourStep[]; onDone: () => void }) {
  // Steps that switch views can't be checked up front; the rest drop out when hidden.
  const [shown] = useState(() => {
    const kept: TourStep[] = [];
    let switched = false;
    for (const s of steps) {
      switched ||= Boolean(s.before);
      if (switched || isVisible(s.target)) kept.push(s);
    }
    return kept;
  });
  const [index, setIndex] = useState(0);
  const [, setResized] = useState(0);
  const step = shown[index];
  // Mounted only after a user action, so the DOM is there to measure while rendering.
  const rect = step ? (document.querySelector(step.target)?.getBoundingClientRect() ?? null) : null;

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    if (!step?.before) return;
    step.before();
    // Measure again once the view it switched to has rendered.
    const frame = requestAnimationFrame(() => setResized((n) => n + 1));
    return () => cancelAnimationFrame(frame);
  }, [step]);

  useEffect(() => {
    if (!step) {
      onDone();
      return;
    }
    const onResize = () => setResized((n) => n + 1);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDone();
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, shown.length - 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
    };
  }, [step, shown.length, onDone]);

  if (!step) return null;
  const found = rect !== null && rect.width > 0;
  // Still switching views: wait a frame for the element.
  if (!found && step.before) return null;
  const last = index === shown.length - 1;
  const cardWidth = Math.min(CARD_WIDTH, window.innerWidth - GUTTER * 2);
  // A hidden element (e.g. on a phone) gets the card alone, near the top.
  const left = found ? Math.min(Math.max(rect.left + rect.width / 2 - cardWidth / 2, GUTTER), window.innerWidth - cardWidth - GUTTER) : (window.innerWidth - cardWidth) / 2;
  const top = found ? rect.bottom + PAD + GAP : 80;

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Quick tour">
      <button type="button" aria-label="Close tour" onClick={onDone} className="absolute inset-0 cursor-default" />
      {found ? (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-lg border-2 border-accent transition-all duration-200"
          style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2, boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)" }}
        />
      ) : (
        <div aria-hidden className="pointer-events-none fixed inset-0 bg-black/60" />
      )}
      <div className="fixed rounded-lg border border-hairline-strong bg-card p-4" style={{ top, left, width: cardWidth }}>
        <p className="text-xs text-ash tnum">
          {index + 1} of {shown.length}
        </p>
        <h2 className="mt-1 text-[15px] font-medium text-ink">{step.title}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-body">{step.body}</p>
        <div className="mt-4 flex items-center gap-2">
          <button type="button" onClick={onDone} className="mr-auto cursor-pointer text-xs text-mute hover:text-ink">
            Skip tour
          </button>
          {index > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setIndex(index - 1)}>
              Back
            </Button>
          )}
          <Button size="sm" variant="primary" onClick={() => (last ? onDone() : setIndex(index + 1))}>
            {last ? "Done" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );
}
