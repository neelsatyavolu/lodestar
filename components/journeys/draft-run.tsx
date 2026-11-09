import { Check, RotateCw, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PlanPart } from "@/lib/journeys/input";
import { PROVIDER_NAME } from "../connect-ai";
import { Spinner } from "../ui";
import { PARTS, type Generator } from "./ai-draft";

// "Draft it for me" after the quick start: the AI fills the plan one part at
// a time (days, what to book, checklist, notes, budget), each shown as it
// lands, and a part that fails can be retried without redoing the rest.

type Step = "pending" | "running" | "done" | "failed";
export type DraftState = { steps: Record<PlanPart, Step>; finished: boolean };

const fresh = (): DraftState => ({ steps: Object.fromEntries(PARTS.map((p) => [p.part, "pending"])) as Record<PlanPart, Step>, finished: false });

/**
 * Runs the quick start's draft once. `onStart` lets the owner of the request
 * drop it, so reopening the trip later never drafts it again.
 */
export function useDraftRun(gen: Generator, request: { wishes: string } | null, ready: boolean, onStart: () => void) {
  const [state, setState] = useState<DraftState | null>(null);
  const started = useRef(false);
  const genRef = useRef(gen);
  const onStartRef = useRef(onStart);
  useEffect(() => {
    genRef.current = gen;
    onStartRef.current = onStart;
  }, [gen, onStart]);

  const step = useCallback(async (part: PlanPart, wishes: string) => {
    setState((s) => s && { ...s, steps: { ...s.steps, [part]: "running" } });
    const ok = await genRef.current.run(part, wishes);
    setState((s) => s && { ...s, steps: { ...s.steps, [part]: ok ? "done" : "failed" } });
    return ok;
  }, []);

  useEffect(() => {
    if (!request || !ready || started.current) return;
    // Started from a timer so the effect itself sets no state. Marked started
    // inside it: a cleanup that cancels the timer (Strict Mode) leaves it unstarted.
    const t = setTimeout(async () => {
      if (started.current) return;
      started.current = true;
      onStartRef.current();
      setState(fresh());
      for (const { part } of PARTS) await step(part, request.wishes);
      setState((s) => s && { ...s, finished: true });
    }, 0);
    return () => clearTimeout(t);
  }, [request, ready, step]);

  const retry = (part: PlanPart) => step(part, request?.wishes ?? "");
  const dismiss = () => setState(null);
  return { state, retry, dismiss };
}

export function DraftProgress({ run, gen }: { run: ReturnType<typeof useDraftRun>; gen: Generator }) {
  const { state } = run;
  if (!state) return null;
  const done = PARTS.filter((p) => state.steps[p.part] === "done").length;
  const current = PARTS.findIndex((p) => state.steps[p.part] === "running");
  const who = gen.provider ? PROVIDER_NAME[gen.provider] : "Your AI";
  return (
    <section aria-label="Drafting the plan" className="rounded-xl border border-hairline-strong bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-2 text-[14px] text-ink" role="status">
          <Sparkles size={15} className="text-accent" aria-hidden />
          {state.finished ? `${who} drafted ${done} of ${PARTS.length} parts. Look it over and change anything.` : current >= 0 ? `${PARTS[current].doing}… ${current + 1}/${PARTS.length}` : `${who} is drafting your trip`}
        </p>
        {state.finished && (
          <button type="button" onClick={run.dismiss} aria-label="Hide" className="-m-2 inline-flex size-9 pointer-coarse:size-11 cursor-pointer items-center justify-center rounded-md text-ash hover:text-ink">
            <X size={14} />
          </button>
        )}
      </div>
      <ol className="mt-3 grid grid-cols-5 gap-2" aria-label="Steps">
        {PARTS.map((p) => {
          const s = state.steps[p.part];
          return (
            <li key={p.part} className="min-w-0">
              <div className={`h-1 rounded-full ${s === "done" ? "bg-accent" : s === "running" ? "animate-pulse bg-accent/60" : s === "failed" ? "bg-danger" : "bg-elevated"}`} aria-hidden />
              <div className="mt-2 flex items-center gap-1 text-[12px]">
                {s === "done" && <Check size={11} className="shrink-0 text-accent" aria-hidden />}
                {s === "running" && <Spinner className="!size-2.5 shrink-0" />}
                <span className={`truncate ${s === "failed" ? "text-danger" : s === "pending" ? "text-ash" : "text-body"}`}>{p.short}</span>
                {s === "failed" && state.finished && (
                  <button type="button" onClick={() => run.retry(p.part)} disabled={gen.running !== null} aria-label={`Retry ${p.doing.toLowerCase()}`} className="ml-auto inline-flex size-6 pointer-coarse:size-11 shrink-0 cursor-pointer items-center justify-center rounded text-mute hover:text-ink">
                    <RotateCw size={11} />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {gen.error && <p className="mt-2 text-[12px] text-danger">{gen.error.text}</p>}
    </section>
  );
}
