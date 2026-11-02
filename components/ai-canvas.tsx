import { ArrowUp, Check, CircleAlert, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Canvas, Plan } from "@/lib/ai/canvas";
import { readNdjson } from "@/lib/client";
import { day, money } from "@/lib/format";
import type { Hack } from "@/lib/hacks";
import type { Itinerary } from "@/lib/types";
import { PROVIDER_NAME, type Provider } from "./connect-ai";
import { ItineraryCard, type SellerCheck } from "./itinerary-card";
import { Button, Pill } from "./ui";

type SearchState = { state: "waiting" | "running" | "done" | "error"; count?: number; cheapest?: number | null; error?: string };
type Board = {
  prompt: string;
  status: string | null;
  plan: Plan | null;
  searches: SearchState[];
  canvas: Canvas | null;
  options: Record<string, { itinerary: Itinerary; search: number }>;
  hacks: (Hack & { search: string })[];
  error: string | null;
  running: boolean;
};

const EXAMPLES = [
  "Bay Area to New York for Thanksgiving week, back the Sunday after. Cheapest that isn't miserable.",
  "A long weekend in Mexico City from LA in early December, nonstop only.",
  "Business class Seattle to Tokyo in March for under $3,000 if possible.",
  "Chicago to London next spring, flexible by a few days, I'm bringing a checked bag.",
];

const TAG_TONE = { best: "green", cheapest: "blue", fastest: "neutral", comfort: "neutral", hack: "yellow", alternative: "neutral" } as const;

export function AiCanvas({
  provider,
  models,
  connected,
  onConnect,
  context,
  checks,
  onCheck,
  trustedOnly,
  filters,
}: {
  provider: Provider | null;
  models: { id: string; label: string }[];
  connected: Record<Provider, boolean>;
  onConnect: () => void;
  context: Record<string, unknown> | null;
  checks: Record<string, SellerCheck>;
  onCheck: (it: Itinerary) => void;
  trustedOnly: boolean;
  filters: Record<string, unknown>;
}) {
  const [prompt, setPrompt] = useState("");
  const [board, setBoard] = useState<Board | null>(null);
  const [model, setModel] = useState<string>("");
  const [active, setActive] = useState<Provider | null>(provider);
  const abort = useRef<AbortController | null>(null);
  const use = active && connected[active] ? active : provider;

  // Stop generating on the traveller's subscription if this view goes away.
  useEffect(() => () => abort.current?.abort(), []);

  const run = async (text: string, previous: Board | null) => {
    if (!use || !text.trim() || board?.running) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    const fresh: Board = { prompt: text, status: "Starting", plan: null, searches: [], canvas: null, options: {}, hacks: [], error: null, running: true };
    setBoard(fresh);
    setPrompt("");
    // Only the newest run may touch the board; an aborted earlier run stays quiet.
    const update = (fn: (b: Board) => Board) => {
      if (abort.current === ctrl) setBoard((b) => (b ? fn(b) : b));
    };
    try {
      const res = await fetch("/api/ai/canvas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: use, model: model || undefined, prompt: text, context, filters, previous: previous?.canvas ? { prompt: previous.prompt, headline: previous.canvas.headline } : null }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        update((b) => ({ ...b, error: body?.error ?? `Request failed (HTTP ${res.status}).`, running: false }));
        return;
      }
      await readNdjson(res, (ev) => {
        switch (ev.type) {
          case "status":
            update((b) => ({ ...b, status: String(ev.text) }));
            break;
          case "plan": {
            const plan = ev.plan as Plan;
            update((b) => ({ ...b, plan, status: plan.searches.length ? `Running ${plan.searches.length} searches` : b.status, searches: plan.searches.map(() => ({ state: "waiting" })) }));
            break;
          }
          case "search":
            update((b) => ({ ...b, searches: b.searches.map((s, i) => (i === ev.index ? { state: ev.state as SearchState["state"], count: ev.count as number, cheapest: ev.cheapest as number, error: ev.error as string } : s)) }));
            break;
          case "canvas":
            update((b) => ({ ...b, canvas: ev.canvas as Canvas, options: ev.options as Board["options"], hacks: ev.hacks as Board["hacks"], status: null }));
            break;
          case "error":
            update((b) => ({ ...b, error: String(ev.error), status: null }));
            break;
          case "done":
            update((b) => ({ ...b, running: false, status: null }));
            break;
        }
      });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) update((b) => ({ ...b, error: "Lost the connection to the AI. Try again.", running: false }));
    } finally {
      update((b) => ({ ...b, running: false }));
    }
  };

  const connectedList = (Object.keys(connected) as Provider[]).filter((p) => connected[p]);

  return (
    <div className="space-y-8">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(prompt, board);
        }}
        className="rounded-xl border border-hairline-strong bg-card"
      >
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              run(prompt, board);
            }
          }}
          rows={3}
          maxLength={1200}
          placeholder="Describe the trip. Where, roughly when, and what matters to you."
          className="block w-full resize-none bg-transparent px-4 pt-4 font-body text-[16px] leading-relaxed text-ink outline-none placeholder:text-stone"
          aria-label="Describe your trip"
        />
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
          {connectedList.length > 1 && (
            <div className="inline-flex rounded-md border border-hairline-strong p-0.5">
              {connectedList.map((p) => (
                <button key={p} type="button" onClick={() => setActive(p)} className={`h-7 cursor-pointer rounded-sm px-3 text-[13px] ${use === p ? "bg-elevated text-ink" : "text-mute"}`}>
                  {PROVIDER_NAME[p]}
                </button>
              ))}
            </div>
          )}
          {use && models.length > 0 && (
            <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model" className="h-8 cursor-pointer rounded-md border border-hairline-strong bg-card px-2 text-[13px] text-ink outline-none">
              <option value="">Default model</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          )}
          {context && <span className="text-xs text-ash">Uses your search form as a starting point</span>}
          <div className="ml-auto">
            {use ? (
              <Button type="submit" variant="primary" disabled={!prompt.trim() || board?.running}>
                {board?.running ? <LoaderCircle size={15} className="animate-spin" /> : <ArrowUp size={15} />}
                Canvas it
              </Button>
            ) : (
              <Button type="button" variant="primary" onClick={onConnect}>
                Connect ChatGPT or Grok
              </Button>
            )}
          </div>
        </div>
      </form>

      {!board && (
        <div className="grid gap-2 sm:grid-cols-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => (use ? run(ex, null) : setPrompt(ex))}
              className="cursor-pointer rounded-lg border border-hairline bg-card p-4 text-left text-[13px] leading-relaxed text-mute hover:border-hairline-strong hover:text-body"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {board && <BoardView board={board} checks={checks} onCheck={onCheck} trustedOnly={trustedOnly} onFollowup={(f) => run(f, board)} />}
    </div>
  );
}

function BoardView({ board, checks, onCheck, trustedOnly, onFollowup }: { board: Board; checks: Record<string, SellerCheck>; onCheck: (it: Itinerary) => void; trustedOnly: boolean; onFollowup: (f: string) => void }) {
  const { plan, canvas } = board;
  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs text-ash">You asked</p>
        <p className="mt-1 font-body text-[15px] text-body">{board.prompt}</p>
      </div>

      {plan && plan.searches.length > 0 && (
        <section aria-label="Searches" className="rounded-lg border border-hairline-strong bg-deep p-4">
          {plan.understanding && <p className="mb-3 text-[13px] text-body">{plan.understanding}</p>}
          <ul className="space-y-2">
            {plan.searches.map((s, i) => {
              const st = board.searches[i];
              return (
                <li key={i} className="flex items-start gap-3 text-[13px]">
                  <span className="mt-0.5 shrink-0">
                    {st?.state === "done" ? <Check size={14} className="text-green" /> : st?.state === "error" ? <CircleAlert size={14} className="text-red" /> : st?.state === "running" ? <LoaderCircle size={14} className="animate-spin text-charcoal" /> : <span className="block size-3.5 rounded-full border border-hairline-strong" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-ink">{s.label}</span>
                    <span className="ml-2 font-mono text-xs text-ash">
                      {s.from.join("/")}→{s.to.join("/")} {day(s.depart)}
                      {s.return ? `–${day(s.return)}` : ""}
                    </span>
                    {s.why && <span className="block text-xs text-ash">{s.why}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-mute tnum">{st?.state === "done" ? (st.cheapest ? `from ${money(st.cheapest)}` : "none") : st?.state === "error" ? "failed" : ""}</span>
                </li>
              );
            })}
          </ul>
          {plan.assumptions.length > 0 && <p className="mt-3 border-t border-hairline pt-3 text-xs text-ash">Assumed: {plan.assumptions.join(" · ")}</p>}
        </section>
      )}

      {board.status && (
        <p className="inline-flex items-center gap-2 text-[13px] text-mute">
          <LoaderCircle size={14} className="animate-spin" /> {board.status}…
        </p>
      )}
      {board.error && <p className="rounded-lg border border-[rgba(255,32,71,0.3)] bg-card p-4 text-[13px] text-red">{board.error}</p>}

      {canvas && (
        <section aria-label="AI picks" className="glow-green -mx-4 space-y-6 px-4 pt-8 sm:-mx-8 sm:px-8">
          <div>
            <h2 className="font-display text-[clamp(32px,5vw,48px)] tracking-[-0.02em] text-ink">{canvas.headline}</h2>
            {canvas.summary && <p className="mt-3 max-w-3xl font-body text-[16px] leading-relaxed text-body">{canvas.summary}</p>}
          </div>
          <div className="space-y-4">
            {canvas.picks.map((p) => {
              const opt = board.options[p.ref];
              if (!opt) return null;
              return (
                <div key={p.ref} className="space-y-2">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Pill tone={TAG_TONE[p.tag]} className="capitalize">
                      {p.tag}
                    </Pill>
                    <h3 className="text-[15px] font-medium text-ink">{p.title}</h3>
                    <span className="text-xs text-ash">from {plan?.searches[opt.search]?.label}</span>
                  </div>
                  <p className="max-w-3xl text-[14px] leading-relaxed text-body">
                    {p.why}
                    {p.tradeoff && <span className="text-mute"> Tradeoff: {p.tradeoff}</span>}
                  </p>
                  <ItineraryCard it={opt.itinerary} badges={[]} check={checks[opt.itinerary.id]} onCheck={() => onCheck(opt.itinerary)} trustedOnly={trustedOnly} alt={new Set()} />
                </div>
              );
            })}
          </div>
          {board.hacks.length > 0 && (
            <div className="rounded-lg border border-hairline-strong bg-card p-4">
              <h3 className="mb-2 text-sm text-ink">Hacks the searches found</h3>
              <ul className="space-y-1.5 text-[13px] text-mute">
                {board.hacks.map((h) => (
                  <li key={`${h.search}-${h.title}`}>
                    <span className="text-green tnum">−{money(h.saving)}</span> <span className="text-body">{h.title}</span> ({h.search}). {h.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {canvas.tips.length > 0 && (
            <ul className="space-y-1.5 text-[13px] text-mute">
              {canvas.tips.map((t) => (
                <li key={t}>— {t}</li>
              ))}
            </ul>
          )}
          {canvas.followups.length > 0 && !board.running && (
            <div className="flex flex-wrap gap-2">
              {canvas.followups.map((f) => (
                <button key={f} type="button" onClick={() => onFollowup(f)} className="h-8 cursor-pointer rounded-full border border-hairline-strong px-3 text-[13px] text-charcoal hover:text-ink">
                  {f}
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
