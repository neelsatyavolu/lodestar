import { ArrowUp, Bookmark, Check, CircleAlert, LoaderCircle } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { Canvas, Plan, TripDefaults } from "@/lib/ai/canvas";
import { ApiError, post, readNdjson } from "@/lib/client";
import { day, money } from "@/lib/format";
import type { Hack } from "@/lib/hacks";
import type { Itinerary } from "@/lib/types";
import type { VerifiedSeller } from "@/lib/verify";
import { AirportField } from "./airport-field";
import { PROVIDER_NAME, type Provider } from "./connect-ai";
import { ItineraryCard, type SellerCheck } from "./itinerary-card";
import type { Fare } from "./sellers-panel";
import { Button, Pill } from "./ui";

type SearchState = { state: "waiting" | "running" | "done" | "error"; count?: number; cheapest?: number | null; error?: string };
export type Board = {
  prompt: string;
  status: string | null;
  plan: Plan | null;
  searches: SearchState[];
  canvas: Canvas | null;
  options: Record<string, { itinerary: Itinerary; search: number }>;
  hacks: (Hack & { search: string })[];
  error: string | null;
  running: boolean;
  /** Set once this shortlist is saved to Trips. */
  savedId?: string;
};

const EXAMPLES = [
  "Bay Area to New York for Thanksgiving week, back the Sunday after. Cheapest that isn't miserable.",
  "A long weekend in Mexico City from LA in early December, nonstop only.",
  "Business class Seattle to Tokyo in March for under $3,000 if possible.",
  "Chicago to London next spring, flexible by a few days, I'm bringing a checked bag.",
];

/** Earlier turns sent with each message, so a short reply has context. */
const MAX_HISTORY = 4;

const TAG_TONE = { best: "accent", cheapest: "neutral", fastest: "neutral", comfort: "neutral", hack: "neutral", alternative: "neutral" } as const;

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
  defaults,
  onSaveHome,
  intro,
  signedIn,
  onSignIn,
  onOpenTrips,
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
  defaults: TripDefaults;
  /** Saves home airports to the traveller's preferences. Resolves with an error message or null. */
  onSaveHome: (codes: string[]) => Promise<string | null>;
  /** Shown until the first message; the conversation replaces it. */
  intro: ReactNode;
  signedIn: boolean;
  onSignIn: () => void;
  /** Shows the saved trip in Trips. */
  onOpenTrips: (id: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [turns, setTurns] = useState<Board[]>([]);
  const [model, setModel] = useState<string>("");
  const [active, setActive] = useState<Provider | null>(provider);
  const abort = useRef<AbortController | null>(null);
  const use = active && connected[active] ? active : provider;
  const last = turns.at(-1) ?? null;
  const running = Boolean(last?.running);
  const started = turns.length > 0;

  // Stop generating on the traveller's subscription if this view goes away.
  useEffect(() => () => abort.current?.abort(), []);

  const run = async (text: string, history: Board[] = turns, tripDefaults: TripDefaults = defaults) => {
    if (!use || !text.trim() || running) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    const index = history.length;
    const fresh: Board = { prompt: text, status: "Starting", plan: null, searches: [], canvas: null, options: {}, hacks: [], error: null, running: true };
    setTurns([...history, fresh]);
    setPrompt("");
    requestAnimationFrame(() => document.getElementById(`turn-${index}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    // Only the newest run may touch its turn; an aborted earlier run stays quiet.
    const update = (fn: (b: Board) => Board) => {
      if (abort.current === ctrl) setTurns((ts) => ts.map((b, i) => (i === index ? fn(b) : b)));
    };
    const earlier = history
      .filter((b) => b.canvas)
      .slice(-MAX_HISTORY)
      .map((b) => ({ prompt: b.prompt, reply: `${b.canvas!.headline} ${b.canvas!.summary}`.trim().slice(0, 600) }));
    try {
      const res = await fetch("/api/ai/canvas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: use, model: model || undefined, prompt: text, context, filters, defaults: tripDefaults, history: earlier }),
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

  const newTrip = () => {
    abort.current?.abort();
    abort.current = null;
    setTurns([]);
    setPrompt("");
  };

  // Saving a home airport answers the planner's question, so ask the same thing again in place.
  const saveHome = async (codes: string[]): Promise<string | null> => {
    const problem = await onSaveHome(codes);
    if (!problem && last) run(last.prompt, turns.slice(0, -1), { ...defaults, homeAirports: codes });
    return problem;
  };

  // Saves a finished shortlist with its searches, so Trips can re-check the fare daily.
  const saveTrip = async (index: number): Promise<string | null> => {
    const b = turns[index];
    if (!b?.plan || !b.canvas) return "Nothing to save yet.";
    const fares = b.searches.map((s) => s.cheapest).filter((c): c is number => typeof c === "number" && c > 0);
    const price = fares.length ? Math.min(...fares) : Math.min(...Object.values(b.options).map((o) => o.itinerary.price));
    try {
      const { id } = await post<{ id: string }>("/api/trips", {
        snapshot: { prompt: b.prompt, plan: b.plan, canvas: b.canvas, options: b.options, hacks: b.hacks, searches: b.searches },
        searches: b.plan.searches,
        filters,
        price,
      });
      setTurns((ts) => ts.map((t, i) => (i === index ? { ...t, savedId: id } : t)));
      return null;
    } catch (err) {
      return err instanceof ApiError ? err.message : "Couldn't save the trip.";
    }
  };

  const connectedList = (Object.keys(connected) as Provider[]).filter((p) => connected[p]);

  return (
    <div className="space-y-8">
      {!started && intro}

      {turns.map((t, i) => {
        const latest = i === turns.length - 1;
        return (
          <div key={i} id={`turn-${i}`} className={`scroll-mt-24 ${i > 0 ? "border-t border-hairline pt-8" : ""}`}>
            <BoardView
              board={t}
              latest={latest}
              checks={checks}
              onCheck={onCheck}
              trustedOnly={trustedOnly}
              onFollowup={(f) => run(f)}
              save={!t.running && t.canvas && t.canvas.picks.length > 0 ? <SaveTrip savedId={t.savedId} signedIn={signedIn} onSignIn={onSignIn} onSave={() => saveTrip(i)} onOpen={onOpenTrips} /> : null}
            />
            {latest && t.plan?.needsOrigin && !t.running && !defaults.homeAirports.length && <OriginAsk onSave={saveHome} />}
          </div>
        );
      })}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(prompt);
        }}
        data-tour="plan-box"
        className="rounded-xl border border-hairline-strong bg-card has-[textarea:focus]:border-accent"
      >
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              run(prompt);
            }
          }}
          rows={started ? 2 : 3}
          maxLength={1200}
          placeholder={started ? "Reply, or change the trip." : "Describe the trip. Where, roughly when, and what matters to you."}
          className="block w-full resize-none bg-transparent px-4 pt-4 text-[16px] leading-relaxed text-ink outline-none placeholder:text-mute focus-visible:outline-none!"
          aria-label={started ? "Reply" : "Describe your trip"}
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
          {context && !started && <span className="text-xs text-ash">Uses your search form as a starting point</span>}
          <div className="ml-auto flex items-center gap-2">
            {started && (
              <Button type="button" variant="ghost" onClick={newTrip}>
                New trip
              </Button>
            )}
            {use ? (
              <Button type="submit" variant="primary" disabled={!prompt.trim() || running}>
                {running ? <LoaderCircle size={15} className="animate-spin" /> : <ArrowUp size={15} />}
                {started ? "Send" : "Plan trip"}
              </Button>
            ) : (
              <Button type="button" variant="primary" onClick={onConnect}>
                Connect ChatGPT or Grok
              </Button>
            )}
          </div>
        </div>
      </form>

      {!started && (
        <div className="grid gap-2 sm:grid-cols-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => (use ? run(ex, []) : setPrompt(ex))}
              className="cursor-pointer rounded-lg border border-hairline bg-card p-4 text-left text-[13px] leading-relaxed text-mute hover:border-hairline-strong hover:text-body"
            >
              {ex}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SaveTrip({ savedId, signedIn, onSignIn, onSave, onOpen }: { savedId?: string; signedIn: boolean; onSignIn: () => void; onSave: () => Promise<string | null>; onOpen: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (savedId)
    return (
      <p className="inline-flex items-center gap-2 text-[13px] text-mute">
        <Check size={14} className="text-ink" /> Saved. We&apos;ll email you if the price drops.{" "}
        <button type="button" onClick={() => onOpen(savedId)} className="cursor-pointer text-accent hover:underline">
          Set alerts
        </button>
      </p>
    );
  if (!signedIn)
    return (
      <Button size="sm" variant="outline" onClick={onSignIn}>
        <Bookmark size={14} /> Sign in to save this trip
      </Button>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(await onSave());
          setBusy(false);
        }}
      >
        <Bookmark size={14} /> {busy ? "Saving…" : "Save trip and get alerts"}
      </Button>
      {error && <span className="text-[13px] text-danger">{error}</span>}
    </span>
  );
}

function OriginAsk({ onSave }: { onSave: (codes: string[]) => Promise<string | null> }) {
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(await onSave(codes));
    setBusy(false);
  };
  return (
    <div className="mt-6 max-w-xl space-y-3 rounded-lg border border-hairline-strong bg-card p-4">
      <AirportField bare label="Where you usually fly from. Saved to your preferences, so Plan won't ask again." value={codes} onChange={setCodes} placeholder="City or airport" />
      {error && <p className="text-[13px] text-danger">{error}</p>}
      <Button variant="primary" size="sm" disabled={!codes.length || busy} onClick={save}>
        {busy ? "Saving…" : "Save and plan"}
      </Button>
    </div>
  );
}

export function BoardView({ board, latest, checks, onCheck, trustedOnly, onFollowup, save = null, onBook }: { board: Board; latest: boolean; save?: ReactNode; checks: Record<string, SellerCheck>; onCheck: (it: Itinerary) => void; trustedOnly: boolean; onFollowup: (f: string) => void; onBook?: (it: Itinerary, seller: VerifiedSeller, fare: Fare) => void }) {
  const { plan, canvas } = board;
  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs text-ash">You asked</p>
        <p className="mt-1 text-[15px] text-body">{board.prompt}</p>
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
                    {st?.state === "done" ? <Check size={14} className="text-ink" /> : st?.state === "error" ? <CircleAlert size={14} className="text-danger" /> : st?.state === "running" ? <LoaderCircle size={14} className="animate-spin text-charcoal" /> : <span className="block size-3.5 rounded-full border border-hairline-strong" />}
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
      {board.error && <p className="rounded-lg border border-danger/40 bg-card p-4 text-[13px] text-danger">{board.error}</p>}

      {canvas && (
        <section aria-label="AI picks" className="rise space-y-6 pt-4">
          <div>
            <h2 className={canvas.picks.length ? "font-display text-[clamp(28px,3.2vw,36px)] leading-tight text-ink" : "text-[22px] leading-snug text-ink"}>{canvas.headline}</h2>
            {canvas.summary && <p className="mt-3 max-w-3xl text-[16px] leading-relaxed text-body">{canvas.summary}</p>}
            {save && <div className="mt-4">{save}</div>}
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
                  <ItineraryCard it={opt.itinerary} badges={[]} check={checks[opt.itinerary.id]} onCheck={() => onCheck(opt.itinerary)} trustedOnly={trustedOnly} alt={new Set()} onBook={onBook && ((s, f) => onBook(opt.itinerary, s, f))} />
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
                    <span className="text-ink tnum">−{money(h.saving)}</span> <span className="text-body">{h.title}</span> ({h.search}). {h.detail}
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
          {latest && canvas.followups.length > 0 && !board.running && (
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
