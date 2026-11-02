"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, post } from "@/lib/client";
import { money } from "@/lib/format";
import { flexHack, type Hack } from "@/lib/hacks";
import { ALLIANCE_LABEL, DEFAULT_PREFERENCES, type Preferences } from "@/lib/preferences";
import type { SearchResult } from "@/lib/search";
import type { DayPrice, Itinerary } from "@/lib/types";
import type { Verified } from "@/lib/verify";
import { SlidersHorizontal } from "lucide-react";
import { AccountDialog, type Account } from "./account-dialog";
import { AiCanvas } from "./ai-canvas";
import { ConnectAI, PROVIDER_NAME, type Provider } from "./connect-ai";
import { GitHubLink, GitHubMark, REPO_URL } from "./github-link";
import { PreferencesDialog } from "./preferences-dialog";
import { ThemeToggle } from "./theme-toggle";
import { DateStrip, HackCards } from "./hacks";
import { ItineraryCard, allAirlines, type SellerCheck } from "./itinerary-card";
import { Results } from "./results";
import { SearchForm, defaultForm, toQuery, type FormState } from "./search-form";
import { Button, Pill } from "./ui";

type Mode = "search" | "ai";
type AiStatus = { connected: Record<Provider, boolean>; models: Record<Provider, { id: string; label: string }[]> };

const AUTO_CHECK = 4;
const CHECK_CONCURRENCY = 2;

/** Runs at most `limit` jobs at once, in the order they were queued. */
function createQueue<T>(limit: number, worker: (item: T) => Promise<void>) {
  let running = 0;
  let pending: T[] = [];
  const drain = () => {
    while (running < limit && pending.length) {
      const item = pending[0];
      pending = pending.slice(1);
      running += 1;
      worker(item).finally(() => {
        running -= 1;
        drain();
      });
    }
  };
  return {
    push(item: T, same: (a: T) => boolean) {
      pending = [...pending.filter((p) => !same(p)), item];
      drain();
    },
    /** Drop everything not yet started and return it. */
    clear(): T[] {
      const dropped = pending;
      pending = [];
      return dropped;
    },
  };
}

function formFromUrl(): FormState | null {
  const p = new URLSearchParams(window.location.search);
  const from = p.get("from")?.split(",").filter(Boolean);
  const to = p.get("to")?.split(",").filter(Boolean);
  const depart = p.get("depart");
  if (!from?.length || !to?.length || !depart) return null;
  const ret = p.get("return");
  return { ...defaultForm(), from, to, depart, return: ret, roundTrip: Boolean(ret), cabin: (p.get("cabin") as FormState["cabin"]) ?? "ECONOMY", adults: Number(p.get("adults") ?? 1) || 1 };
}

/** Saved preferences as form defaults. Airports already typed (or from a shared link) are kept. */
function applyPreferences(f: FormState, p: Preferences): FormState {
  return { ...f, from: f.from.length ? f.from : p.homeAirports, cabin: p.cabin, stops: p.stops, adults: p.adults, bags: p.bags, nearby: p.nearby, flexible: p.flexible, split: p.split };
}

/** The search request: the form plus the traveller's filters. */
function queryFor(f: FormState, p: Preferences) {
  return {
    ...toQuery(f),
    alliances: p.alliances,
    avoidAirlines: p.avoidedAirlines,
    preferAirlines: p.preferredAirlines,
    noBasicEconomy: p.noBasicEconomy,
    avoidRedEyes: p.avoidRedEyes,
    avoidSelfTransfer: p.avoidSelfTransfer,
  };
}

/** Short labels for the filters in effect, shown under the search form. */
function preferenceChips(p: Preferences): string[] {
  return [
    ...p.alliances.map((a) => `${ALLIANCE_LABEL[a]} only`),
    p.preferredAirlines.length ? `Prefer ${p.preferredAirlines.join(", ")}` : "",
    p.avoidedAirlines.length ? `Never ${p.avoidedAirlines.join(", ")}` : "",
    p.avoidRedEyes ? "No red-eyes" : "",
    p.noBasicEconomy ? "No basic economy" : "",
    p.avoidSelfTransfer ? "No self-transfers" : "",
  ].filter(Boolean);
}

function formToUrl(f: FormState): string {
  const p = new URLSearchParams({ from: f.from.join(","), to: f.to.join(","), depart: f.depart });
  if (f.roundTrip && f.return) p.set("return", f.return);
  if (f.cabin !== "ECONOMY") p.set("cabin", f.cabin);
  if (f.adults !== 1) p.set("adults", String(f.adults));
  return `?${p}`;
}

export function App() {
  const [mode, setMode] = useState<Mode>("search");
  const [form, setForm] = useState<FormState>(defaultForm);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [searched, setSearched] = useState<FormState | null>(null);
  const [calendar, setCalendar] = useState<{ key: string; days: DayPrice[] | null; loading: boolean }>({ key: "", days: null, loading: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, SellerCheck>>({});
  const [trustedOnly, setTrustedOnly] = useState(true);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [accountDialog, setAccountDialog] = useState<{ open: boolean; mode: "signin" | "register"; key: number }>({ open: false, mode: "signin", key: 0 });
  const [prefsDialog, setPrefsDialog] = useState({ open: false, key: 0 });
  const prefsRef = useRef<Preferences>(DEFAULT_PREFERENCES);
  const searchCtrl = useRef<AbortController | null>(null);
  const started = useRef(new Set<string>());
  const queue = useRef<ReturnType<typeof createQueue<Itinerary>> | null>(null);

  const refreshAi = useCallback(() => {
    api<AiStatus>("/api/ai/status").then(setAi).catch(() => setAi({ connected: { codex: false, grok: false }, models: { codex: [], grok: [] } }));
  }, []);

  const sellerQueue = useCallback(() => {
    queue.current ??= createQueue<Itinerary>(CHECK_CONCURRENCY, (it) =>
      post<Verified>("/api/sellers", { tfs: it.tfs, airlines: allAirlines(it), price: it.price })
        .then((data) => setChecks((c) => ({ ...c, [it.id]: { state: "done", data } })))
        .catch((err) => setChecks((c) => ({ ...c, [it.id]: { state: "error", error: err instanceof Error ? err.message : "Seller check failed." } }))),
    );
    return queue.current;
  }, []);

  const check = useCallback(
    (it: Itinerary, retry = true) => {
      if (!it.tfs) return;
      if (started.current.has(it.id) && !retry) return;
      started.current.add(it.id);
      setChecks((c) => ({ ...c, [it.id]: { state: "loading" } }));
      sellerQueue().push(it, (q) => q.id === it.id);
    },
    [sellerQueue],
  );

  const search = useCallback(
    async (f: FormState) => {
      searchCtrl.current?.abort();
      const ctrl = new AbortController();
      searchCtrl.current = ctrl;
      setBusy(true);
      setError(null);
      setSplitOpen(false);
      setHighlight(null);
      window.history.replaceState(null, "", formToUrl(f));
      try {
        const data = await post<SearchResult>("/api/search", queryFor(f, prefsRef.current), ctrl.signal);
        setResult(data);
        setSearched(f);
        // Checks queued for the old results never ran: reset them so they can be retried.
        const dropped = sellerQueue().clear();
        if (dropped.length) {
          dropped.forEach((it) => started.current.delete(it.id));
          setChecks((c) => Object.fromEntries(Object.entries(c).filter(([id]) => !dropped.some((it) => it.id === id))));
        }
        if (f.flexible) {
          // The calendar is slow on Google's side; show results first and add it when it lands.
          const key = formToUrl(f);
          setCalendar({ key, days: null, loading: true });
          post<DayPrice[]>("/api/calendar", queryFor(f, prefsRef.current), ctrl.signal)
            .then((days) => setCalendar((c) => (c.key === key ? { key, days, loading: false } : c)))
            .catch(() => setCalendar((c) => (c.key === key ? { key, days: [], loading: false } : c)));
        } else setCalendar({ key: "", days: null, loading: false });
        data.itineraries.slice(0, AUTO_CHECK).forEach((it) => check(it, false));
      } catch (err) {
        if (ctrl.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
        setError(err instanceof ApiError ? err.message : "Search failed. Try again.");
        setResult(null);
      } finally {
        if (searchCtrl.current === ctrl) setBusy(false);
      }
    },
    [check, sellerQueue],
  );

  const adoptPreferences = useCallback((p: Preferences, fillForm: boolean) => {
    prefsRef.current = p;
    setPrefs(p);
    setTrustedOnly(p.trustedOnly);
    if (fillForm) setForm((f) => applyPreferences(f, p));
  }, []);

  useEffect(() => {
    refreshAi();
    const fromUrl = formFromUrl();
    // Saved preferences first (they filter the search), then a shared link's search if there is one.
    api<{ user: Account | null; preferences: Preferences | null }>("/api/account")
      .then((res) => {
        setAccount(res.user);
        if (res.preferences) adoptPreferences(res.preferences, !fromUrl);
      })
      .catch(() => {})
      .finally(() => {
        if (fromUrl) {
          setForm(fromUrl);
          search(fromUrl);
        }
      });
  }, [refreshAi, search, adoptPreferences]);

  const savePreferences = async (p: Preferences): Promise<string | null> => {
    if (account) {
      try {
        await api("/api/preferences", { method: "PUT", body: JSON.stringify(p) });
      } catch (err) {
        return err instanceof Error ? err.message : "Couldn't save your preferences.";
      }
    }
    adoptPreferences(p, true);
    if (result && searched) search(applyPreferences(searched, p));
    return null;
  };

  const signedIn = (a: Account, p: Preferences) => {
    setAccount(a);
    adoptPreferences(p, true);
  };

  const signOut = async () => {
    await post("/api/account/logout", {}).catch(() => {});
    setAccount(null);
    adoptPreferences(DEFAULT_PREFERENCES, false);
    refreshAi();
  };

  const focus = (id: string) => {
    setHighlight(id);
    const it = result?.itineraries.find((i) => i.id === id);
    if (it && !checks[id]) check(it);
    requestAnimationFrame(() => document.getElementById(`it-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  const onHack = (h: Hack) => {
    if (h.kind === "flex" && h.apply) {
      const next = { ...form, depart: h.apply.depart ?? form.depart, return: h.apply.return ?? form.return };
      setForm(next);
      search(next);
    } else if (h.kind === "split") {
      setSplitOpen(true);
      requestAnimationFrame(() => document.getElementById("split")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } else if (h.itineraryIds[0]) focus(h.itineraryIds[0]);
  };

  const connected = ai?.connected ?? { codex: false, grok: false };
  const provider: Provider | null = connected.codex ? "codex" : connected.grok ? "grok" : null;
  const alt = new Set([...(result?.airports.nearbyFrom ?? []), ...(result?.airports.nearbyTo ?? [])]);
  const dateHack = result && searched && calendar.days ? flexHack(calendar.days, searched.depart, searched.roundTrip ? searched.return : null, searched.bags ? null : result.baseline) : null;
  const hacks = result ? [...result.hacks, ...(dateHack ? [dateHack] : [])].sort((a, b) => b.saving - a.saving) : [];
  const split = result?.hacks.find((h) => h.kind === "split");
  const splitPair = split && result?.oneWays ? [result.oneWays.out.find((i) => i.id === split.itineraryIds[0]), result.oneWays.back.find((i) => i.id === split.itineraryIds[1])].filter((i): i is Itinerary => Boolean(i)) : [];

  const disconnect = async (p: Provider) => {
    await post(`/api/ai/${p}/logout`, {}).catch(() => {});
    refreshAi();
  };

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-hairline bg-canvas">
        <div className="mx-auto flex h-16 max-w-[1120px] items-center gap-2 px-4 sm:gap-4 sm:px-8">
          <Link href="/" className="flex items-center gap-2" aria-label="Lodestar home">
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
              <path d="M11 1.5 L12.6 9.4 L20.5 11 L12.6 12.6 L11 20.5 L9.4 12.6 L1.5 11 L9.4 9.4 Z" fill="currentColor" />
            </svg>
            <span className="text-[18px] font-medium tracking-[-0.02em] max-[400px]:sr-only">Lodestar</span>
          </Link>
          <nav className="inline-flex shrink-0 rounded-full bg-elevated p-0.5 text-[13px] sm:ml-2" aria-label="Mode">
            {(["search", "ai"] as Mode[]).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)} aria-current={mode === m} className={`h-8 cursor-pointer whitespace-nowrap rounded-full px-3 sm:px-3.5 ${mode === m ? "bg-hover text-ink" : "text-mute hover:text-charcoal"}`}>
                {m === "search" ? "Search" : "AI canvas"}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <ThemeToggle />
            <GitHubLink />
            <button
              type="button"
              onClick={() => setPrefsDialog((d) => ({ open: true, key: d.key + 1 }))}
              aria-label="Travel preferences"
              title="Travel preferences"
              className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-charcoal hover:text-ink max-sm:size-10"
            >
              <SlidersHorizontal size={16} />
            </button>
            {account ? (
              <button type="button" onClick={signOut} title={`Signed in as ${account.email}. Click to sign out.`} className="cursor-pointer max-sm:hidden">
                <Pill>{account.email.split("@")[0]}</Pill>
              </button>
            ) : (
              <Button size="sm" variant="quiet" onClick={() => setAccountDialog((d) => ({ open: true, mode: "signin", key: d.key + 1 }))}>
                Sign in
              </Button>
            )}
            {provider ? (
              <button type="button" onClick={() => disconnect(provider)} title="Disconnect" className="cursor-pointer">
                <Pill dot="ok">
                  <span className="sm:hidden">{PROVIDER_NAME[provider]}</span>
                  <span className="max-sm:hidden">{PROVIDER_NAME[provider]} connected</span>
                </Pill>
              </button>
            ) : (
              <Button size="sm" onClick={() => setConnectOpen(true)}>
                <span className="sm:hidden">Connect</span>
                <span className="max-sm:hidden">Connect AI</span>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 pb-24 sm:px-8">
        {/* Both modes stay mounted so switching tabs keeps the search and a running AI canvas. */}
        <div hidden={mode !== "search"}>
            <section className={`${result ? "pt-8 pb-6" : "pt-20 pb-10 sm:pt-28"}`}>
              {!result && (
                <div className="mb-10 max-w-4xl">
                  <h1 className="font-display text-[clamp(44px,8vw,88px)] tracking-[-0.02em]">
                    Lower fares.
                    <br />
                    <span className="text-charcoal">Sellers you can trust.</span>
                  </h1>
                  <p className="mt-6 max-w-xl text-[18px] leading-relaxed text-body">
                    Live prices from Google Flights, checked seller by seller. Every search also tries nearby airports, nearby dates and two one-way tickets, and leaves out agencies we haven&apos;t vetted.
                  </p>
                </div>
              )}
              <SearchForm form={form} onChange={setForm} onSubmit={() => search(form)} busy={busy} />
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                {preferenceChips(prefs).map((c) => (
                  <Pill key={c}>{c}</Pill>
                ))}
                <button type="button" onClick={() => setPrefsDialog((d) => ({ open: true, key: d.key + 1 }))} className="cursor-pointer px-1 text-accent hover:underline">
                  {account ? "Edit preferences" : "Set alliances and preferences"}
                </button>
                {!account && (
                  <span className="text-ash">
                    ·{" "}
                    <button type="button" onClick={() => setAccountDialog((d) => ({ open: true, mode: "register", key: d.key + 1 }))} className="cursor-pointer text-charcoal hover:text-ink">
                      create an account
                    </button>{" "}
                    to keep them
                  </span>
                )}
              </div>
            </section>

            {error && <p className="mb-6 rounded-lg border border-danger/40 bg-card p-4 text-sm text-danger">{error}</p>}
            {busy && !result && (
              <div className="space-y-2.5">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="skeleton h-24 rounded-lg" />
                ))}
              </div>
            )}

            {result && (
              <div className={`space-y-6 transition-opacity ${busy ? "pointer-events-none opacity-50" : ""}`}>
                {result.warnings.length > 0 && <p className="text-xs text-ash">Some extra checks didn&apos;t finish: {result.warnings.join("; ")}</p>}
                <HackCards hacks={hacks} onAction={onHack} />
                <DateStrip
                  days={calendar.days ?? []}
                  selected={searched?.depart ?? form.depart}
                  onPick={(d) => {
                    const next = { ...form, depart: d.depart, return: form.roundTrip ? (d.return ?? form.return) : form.return };
                    setForm(next);
                    search(next);
                  }}
                />
                {calendar.loading && <p className="text-xs text-ash">Checking prices three days either side…</p>}
                {splitOpen && splitPair.length === 2 && (
                  <section id="split" className="space-y-2.5 rounded-xl border border-hairline-strong bg-deep p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-sm text-ink">Two one-way tickets · {money(splitPair[0].price + splitPair[1].price)} total</h3>
                      <button type="button" onClick={() => setSplitOpen(false)} className="cursor-pointer text-xs text-ash hover:text-ink">
                        Close
                      </button>
                    </div>
                    <p className="text-xs text-ash">{split?.caution}</p>
                    {splitPair.map((it) => (
                      <ItineraryCard key={it.id} it={it} badges={[]} check={checks[it.id]} onCheck={() => check(it)} trustedOnly={trustedOnly} alt={alt} />
                    ))}
                  </section>
                )}
                {result.itineraries.length ? (
                  <Results itineraries={result.itineraries} labels={result.labels} checks={checks} onCheck={check} alt={alt} highlight={highlight} trustedOnly={trustedOnly} setTrustedOnly={setTrustedOnly} />
                ) : (
                  <p className="rounded-lg border border-hairline-strong bg-card p-6 text-sm text-mute">No flights found for these dates. Try nearby dates or other airports.</p>
                )}
              </div>
            )}
        </div>
        <div hidden={mode !== "ai"}>
          <section className="pt-16 sm:pt-24">
            <div className="mb-10 max-w-4xl">
              <h1 className="font-display text-[clamp(40px,7vw,76px)] tracking-[-0.02em]">
                Say the trip.
                <br />
                <span className="text-charcoal">Get the shortlist.</span>
              </h1>
              <p className="mt-6 max-w-xl text-[18px] leading-relaxed text-body">
                Your ChatGPT or Grok account plans several live searches at once (other airports, other days, other cabins), then lays the best options out with the reasons and the catches.
              </p>
            </div>
            <AiCanvas
              provider={provider}
              models={provider ? (ai?.models[provider] ?? []) : []}
              connected={connected}
              onConnect={() => setConnectOpen(true)}
              context={form.from.length && form.to.length ? toQuery(form) : null}
              filters={{
                alliances: prefs.alliances,
                avoidAirlines: prefs.avoidedAirlines,
                preferAirlines: prefs.preferredAirlines,
                noBasicEconomy: prefs.noBasicEconomy,
                avoidRedEyes: prefs.avoidRedEyes,
                avoidSelfTransfer: prefs.avoidSelfTransfer,
              }}
              checks={checks}
              onCheck={check}
              trustedOnly={trustedOnly}
            />
          </section>
        </div>
      </main>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-8 text-xs text-ash sm:px-8">
          <span>Live fares from Google Flights. Lodestar doesn&apos;t sell tickets: you book with the airline or agency.</span>
          <span>Prices in USD, taxes included, per the seller at search time.</span>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-charcoal hover:text-ink sm:ml-auto">
            <GitHubMark size={14} /> Open source on GitHub · MIT
          </a>
        </div>
      </footer>

      <AccountDialog
        key={`account-${accountDialog.key}`}
        open={accountDialog.open}
        initialMode={accountDialog.mode}
        onClose={() => setAccountDialog((d) => ({ ...d, open: false }))}
        onSignedIn={signedIn}
        pendingPreferences={prefs}
      />
      <PreferencesDialog
        key={`prefs-${prefsDialog.key}`}
        open={prefsDialog.open}
        onClose={() => setPrefsDialog((d) => ({ ...d, open: false }))}
        value={prefs}
        signedIn={Boolean(account)}
        onSave={savePreferences}
        onCreateAccount={(p) => {
          adoptPreferences(p, true);
          setAccountDialog((d) => ({ open: true, mode: "register", key: d.key + 1 }));
        }}
      />
      <ConnectAI open={connectOpen} onClose={() => setConnectOpen(false)} onConnected={() => refreshAi()} />
    </>
  );
}
