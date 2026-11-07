import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, post } from "@/lib/client";
import type { PlanPart } from "@/lib/journeys/input";
import type { TripDetail } from "@/lib/journeys/types";
import { PROVIDER_NAME, type Provider } from "../connect-ai";
import { Button, Spinner } from "../ui";
import { errorText } from "./shared";

// The traveller's own ChatGPT or Grok fills one part of the plan at a time.
// A part takes 30 to 90 seconds, so the button shows what it's doing and for
// how long, and a failure says why without losing what's already there.

export const PARTS: { part: PlanPart; short: string; doing: string; button: string }[] = [
  { part: "itinerary", short: "Days", doing: "Drafting the days", button: "Draft the days" },
  { part: "to_book", short: "To book", doing: "Finding what to book", button: "Find what to book" },
  { part: "checklist", short: "Checklist", doing: "Writing the checklist", button: "Write a checklist" },
  { part: "notes", short: "Notes", doing: "Writing notes", button: "Write notes" },
  { part: "budget", short: "Budget", doing: "Estimating costs", button: "Estimate costs" },
];
export const partInfo = (p: PlanPart) => PARTS.find((x) => x.part === p)!;

export type Generator = {
  provider: Provider | null;
  running: PlanPart | null;
  elapsed: number;
  error: { part: PlanPart; text: string } | null;
  notice: string | null;
  run: (part: PlanPart, wishes?: string) => Promise<boolean>;
};

function failure(err: unknown): string {
  if (err instanceof ApiError && err.status === 404) return "AI drafting isn't available on this server yet. Add things by hand for now.";
  return errorText(err, "The AI didn't answer. Try again.");
}

export function useGenerate(journeyId: string, provider: Provider | null, onConnectAi: () => void, onTrip: (t: TripDetail) => void): Generator {
  const [running, setRunning] = useState<PlanPart | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<Generator["error"]>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [running]);

  const run = useCallback(
    async (part: PlanPart, wishes?: string) => {
      if (!provider) {
        onConnectAi();
        return false;
      }
      if (busy.current) return false;
      busy.current = true;
      setRunning(part);
      setElapsed(0);
      setError(null);
      setNotice(null);
      try {
        const r = await post<{ journey: TripDetail; added: number }>(`/api/journeys/${journeyId}/generate`, { provider, part, ...(wishes?.trim() ? { wishes: wishes.trim() } : {}) });
        onTrip(r.journey);
        setNotice(r.added ? `Added ${r.added} from ${PROVIDER_NAME[provider]}. Edit or remove anything.` : `${PROVIDER_NAME[provider]} had nothing new to add.`);
        return true;
      } catch (err) {
        setError({ part, text: failure(err) });
        return false;
      } finally {
        busy.current = false;
        setRunning(null);
      }
    },
    [journeyId, provider, onConnectAi, onTrip],
  );

  return { provider, running, elapsed, error, notice, run };
}

/** A button that asks the AI for one part of the plan. */
export function AiButton({ gen, part, label, variant = "ghost" }: { gen: Generator; part: PlanPart; label?: string; variant?: "ghost" | "primary" }) {
  const mine = gen.running === part;
  return (
    <Button size="sm" variant={variant} disabled={gen.running !== null} onClick={() => gen.run(part)} title={gen.provider ? `Uses your ${PROVIDER_NAME[gen.provider]} account` : "Connect ChatGPT or Grok first"}>
      {mine ? <Spinner /> : <Sparkles size={14} aria-hidden />} {label ?? partInfo(part).button}
    </Button>
  );
}

/** What the AI is doing for this tab's parts, or what went wrong. */
export function AiStatus({ gen, parts }: { gen: Generator; parts: PlanPart[] }) {
  if (gen.running && parts.includes(gen.running))
    return (
      <p className="text-[13px] text-mute" role="status">
        {partInfo(gen.running).doing}… <span className="tnum">{gen.elapsed}s</span>
        {gen.elapsed > 20 && <span className="text-ash"> · this usually takes under a minute</span>}
      </p>
    );
  if (gen.error && parts.includes(gen.error.part))
    return (
      <p className="text-[13px] text-danger" role="alert">
        {gen.error.text}
      </p>
    );
  return null;
}

/** A tab with nothing in it yet: what goes here, and two ways to fill it. */
export function EmptyState({ icon, title, body, children }: { icon: ReactNode; title: string; body: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-hairline-strong px-6 py-10 text-center">
      <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-elevated text-charcoal">{icon}</div>
      <h3 className="mt-4 text-[15px] font-medium text-ink">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-mute [text-wrap:pretty]">{body}</p>
      {children && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{children}</div>}
    </div>
  );
}

/** A tab's heading row: a title, a short line under it, and actions on the right. */
export function TabHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[20px] font-medium tracking-[-0.01em] text-ink">{title}</h2>
        {sub && <p className="mt-1 text-[13px] text-mute">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
