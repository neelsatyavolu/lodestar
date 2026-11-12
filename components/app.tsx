"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { safeReturnPath } from "@/lib/account/return-path";
import { ApiError, api, post } from "@/lib/client";
import { money } from "@/lib/format";
import { flexHack, type Hack } from "@/lib/hacks";
import { ALLIANCE_LABEL, DEFAULT_PREFERENCES, displayName, type Preferences } from "@/lib/preferences";
import type { SearchResult } from "@/lib/search";
import type { DayPrice, Itinerary } from "@/lib/types";
import type { Verified } from "@/lib/verify";
import { Bot, SlidersHorizontal } from "lucide-react";
import { AccountDialog, type Account } from "./account-dialog";
import { AgentAccess } from "./agent-access";
import { AiCanvas } from "./ai-canvas";
import { ConfirmHost } from "./confirm";
import { ConnectAI, PROVIDER_NAME, type Provider } from "./connect-ai";
import { GitHubLink, GitHubMark, REPO_URL } from "./github-link";
import { PreferencesDialog } from "./preferences-dialog";
import { ThemeToggle } from "./theme-toggle";
import { Onboarding } from "./onboarding";
import { Tour, type TourStep } from "./tour";
import { Stays } from "./stays";
import { Trips } from "./trips";
import { Journeys } from "./journeys/journeys";
import { DateStrip, HackCards } from "./hacks";
import { ItineraryCard, allAirlines, type SellerCheck } from "./itinerary-card";
import { Results } from "./results";
import { SearchForm, defaultForm, toQuery, type FormState } from "./search-form";
import { Button, Pill } from "./ui";

type Mode = "search" | "stays" | "ai" | "trips";
const MODE_LABEL: Record<Mode, string> = { search: "Search", stays: "Stays", ai: "Plan", trips: "Trips" };

function tourSteps(showPlan: () => void): TourStep[] {
  return [
    { target: '[data-tour="ai"]', title: "Plan", body: "Start here. Plan finds flights from a plain sentence instead of a form.", before: showPlan },
    { target: '[data-tour="plan-box"]', title: "Say the trip", body: "Type where and roughly when, like “Chennai Dec 7 to 20, nonstop if it's close”. Plan runs several live searches with your preferences and shortlists the best options. Reply to change anything." },
    { target: '[data-tour="search"]', title: "Search", body: "Prefer a form? Search shows live fares and also tries nearby airports, a few days either side, and two one-way tickets." },
    { target: '[data-tour="trips"]', title: "Trips", body: "All your trips, day by day. Forward a confirmation or connect Flint and it files itself. Saved Plan shortlists are watched here too, with an email when the fare drops." },
    { target: '[data-tour="prefs"]', title: "Your preferences", body: "Everything you just set lives here. Change it any time." },
    { target: '[data-tour="account"]', title: "Your account", body: "Click your name for preferences, your AI connection and sign out." },
  ];
}
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

/** Set while signed in, so the Trips tab shows before the account check answers. */
const SIGNED_IN_KEY = "lodestar:signed-in";
const readRemembered = () => {
  try {
    return localStorage.getItem(SIGNED_IN_KEY) === "1";
  } catch {
    return false;
  }
};
const noSubscribe = () => () => {};
const remember = (on: boolean) => {
  try {
    if (on) localStorage.setItem(SIGNED_IN_KEY, "1");
    else localStorage.removeItem(SIGNED_IN_KEY);
  } catch {
    // Storage blocked: the tab shows once the account check answers.
  }
};

export function App() {
  const [mode, setMode] = useState<Mode>("search");
  // Until the account check answers, trust the last visit: the Trips tab shows straight away.
  const remembered = useSyncExternalStore(noSubscribe, readRemembered, () => false);
  const [accountChecked, setAccountChecked] = useState(false);
  // The saved trip to show in Trips, from an alert email's link or a fresh save.
  const [focusTrip, setFocusTrip] = useState<string | null>(null);
  // Set by Flint's pairing page link (/?connect=flint): opens Trips with the Connect Flint steps.
  const [pairFlint, setPairFlint] = useState(false);
  const pairAfterSignIn = useRef(false);
  // An invite link (/?invite=…) opened signed out: joined right after signing in.
  const inviteAfterSignIn = useRef<string | null>(null);
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
  const [agentsOpen, setAgentsOpen] = useState(false);
  // Where to go after signing in, when a page on this site (like an agent's consent screen) sent the traveller here.
  const afterSignIn = useRef<string | null>(null);
  const [onboarding, setOnboarding] = useState({ open: false, key: 0 });
  const [touring, setTouring] = useState(false);
  // Set when onboarding hands off to the AI sign-in, so the tour starts once that closes.
  const tourAfterConnect = useRef(false);
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

  /** Joins the trip an invite link is for and opens it. */
  const joinInvite = useCallback(async (token: string) => {
    try {
      const { journeyId } = await post<{ journeyId: string }>("/api/invites/accept", { token });
      window.history.replaceState(null, "", `/?trip=${journeyId}`);
      setMode("trips");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open that invite.");
    }
  }, []);

  useEffect(() => {
    refreshAi();
    const fromUrl = formFromUrl();
    // Saved preferences first (they filter the search), then a shared link's search if there is one.
    api<{ user: Account | null; preferences: Preferences | null }>("/api/account")
      .then((res) => {
        setAccount(res.user);
        remember(Boolean(res.user));
        const trip = new URLSearchParams(window.location.search).get("trip");
        if (res.user && trip) {
          setFocusTrip(trip);
          setMode("trips");
        } else if (trip) {
          // A trip link opened signed out: sign in, then come back to it.
          afterSignIn.current = safeReturnPath(`${window.location.pathname}${window.location.search}`, window.location.origin);
          setAccountDialog((d) => ({ open: true, mode: "signin", key: d.key + 1 }));
        }
        if (new URLSearchParams(window.location.search).get("connect") === "flint") {
          window.history.replaceState(null, "", window.location.pathname);
          if (res.user) {
            setMode("trips");
            setPairFlint(true);
          } else {
            pairAfterSignIn.current = true;
            setAccountDialog((d) => ({ open: true, mode: "signin", key: d.key + 1 }));
          }
        }
        const query = new URLSearchParams(window.location.search);
        const invite = query.get("invite");
        if (invite) {
          // Out of the address bar first: the token works once and shouldn't sit in history.
          window.history.replaceState(null, "", window.location.pathname);
          if (res.user) joinInvite(invite);
          else {
            inviteAfterSignIn.current = invite;
            setAccountDialog((d) => ({ open: true, mode: "register", key: d.key + 1 }));
          }
        }
        if (query.has("agents") && res.user) setAgentsOpen(true);
        if (query.has("signin") && !res.user) {
          const next = query.get("next");
          afterSignIn.current = safeReturnPath(next, window.location.origin);
          setAccountDialog((d) => ({ open: true, mode: "signin", key: d.key + 1 }));
        }
        if (res.preferences) adoptPreferences(res.preferences, !fromUrl);
      })
      .catch(() => {})
      .finally(() => {
        setAccountChecked(true);
        // Development only: /?welcome replays the sign-up onboarding and tour.
        if (process.env.NODE_ENV !== "production" && new URLSearchParams(window.location.search).has("welcome")) {
          setOnboarding((o) => ({ open: true, key: o.key + 1 }));
        }
        if (fromUrl) {
          setForm(fromUrl);
          search(fromUrl);
        }
      });
  }, [refreshAi, search, adoptPreferences, joinInvite]);

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

  const signedIn = (a: Account, p: Preferences, created: boolean) => {
    setAccount(a);
    remember(true);
    adoptPreferences(p, true);
    refreshAi();
    if (afterSignIn.current) {
      window.location.assign(afterSignIn.current);
      return;
    }
    if (inviteAfterSignIn.current) {
      const token = inviteAfterSignIn.current;
      inviteAfterSignIn.current = null;
      joinInvite(token);
      return;
    }
    if (pairAfterSignIn.current) {
      pairAfterSignIn.current = false;
      setMode("trips");
      setPairFlint(true);
      return;
    }
    // A new account answers a few questions, connects its AI, then gets a short tour.
    if (created) setOnboarding((o) => ({ open: true, key: o.key + 1 }));
  };

  const signOut = async () => {
    await post("/api/account/logout", {}).catch(() => {});
    setAccount(null);
    remember(false);
    setMode((m) => (m === "trips" ? "search" : m));
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
    if (h.apply) {
      // The hack names the search changes that reproduce it; run that search.
      const base = searched ?? form;
      const a = h.apply;
      const next: FormState = {
        ...base,
        from: a.from ?? base.from,
        depart: a.depart ?? base.depart,
        cabin: a.cabin ?? base.cabin,
        adults: a.adults ?? base.adults,
        ...(a.return !== undefined ? { return: a.return, roundTrip: a.return !== null ? true : base.roundTrip } : {}),
      };
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

  const onPairShown = useCallback(() => setPairFlint(false), []);

  const disconnect = async (p: Provider) => {
    await post(`/api/ai/${p}/logout`, {}).catch(() => {});
    refreshAi();
  };

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-hairline bg-canvas">
        <div className="mx-auto flex h-16 max-w-[1120px] items-center gap-1 px-4 sm:gap-4 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2 pointer-coarse:min-h-11" aria-label="Lodestar home">
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
              <path d="M11 1.5 L12.6 9.4 L20.5 11 L12.6 12.6 L11 20.5 L9.4 12.6 L1.5 11 L9.4 9.4 Z" fill="currentColor" />
            </svg>
            <span className="text-[18px] font-medium tracking-[-0.02em] max-md:sr-only">Lodestar</span>
          </Link>
          <nav className="ml-1 inline-flex min-w-0 overflow-x-auto rounded-full bg-elevated p-1 text-[13px] [scrollbar-width:none] pointer-coarse:p-0 sm:ml-2" aria-label="Mode">
            {((account || (remembered && !accountChecked) ? ["search", "stays", "ai", "trips"] : ["search", "stays", "ai"]) as Mode[]).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)} aria-current={mode === m} data-tour={m} className={`h-8 shrink-0 cursor-pointer whitespace-nowrap rounded-full px-2 pointer-coarse:h-11 md:px-4 ${mode === m ? "bg-hover text-ink" : "text-mute hover:text-charcoal"}`}>
                {MODE_LABEL[m]}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-1 max-sm:pointer-coarse:gap-0 sm:gap-2">
            <ThemeToggle />
            <span className="max-lg:hidden">
              <GitHubLink />
            </span>
            <button
              type="button"
              onClick={() => setPrefsDialog((d) => ({ open: true, key: d.key + 1 }))}
              aria-label="Travel preferences"
              data-tour="prefs"
              title="Travel preferences"
              className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-charcoal hover:text-ink pointer-coarse:size-11"
            >
              <SlidersHorizontal size={16} />
            </button>
            {account && (
              <button type="button" onClick={() => setAgentsOpen(true)} aria-label="Agents" title="Agents: connect Claude, ChatGPT or Codex" className="inline-flex size-8 pointer-coarse:size-11 cursor-pointer items-center justify-center rounded-md text-charcoal hover:text-ink max-sm:hidden">
                <Bot size={16} />
              </button>
            )}
            {account ? (
              <button type="button" onClick={() => setPrefsDialog((d) => ({ open: true, key: d.key + 1 }))} title={`Signed in as ${account.email}`} data-tour="account" className="shrink-0 cursor-pointer max-sm:hidden">
                <Pill>{displayName(prefs.displayName, account.email)}</Pill>
              </button>
            ) : (
              <Button size="sm" variant="quiet" onClick={() => setAccountDialog((d) => ({ open: true, mode: "signin", key: d.key + 1 }))}>
                Sign in
              </Button>
            )}
            {/* Once connected the AI needs no badge; it's disconnected from the preferences dialog. */}
            {!provider && ai && (
              <Button size="sm" onClick={() => setConnectOpen(true)} data-tour="connect" className="max-sm:hidden">
                Connect AI
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 pb-24 sm:px-6">
        {/* Both modes stay mounted so switching tabs keeps the search and a running AI canvas. */}
        <div hidden={mode !== "search"}>
            <section className={`${result ? "pt-8 pb-6" : "pt-16 pb-12 sm:pt-24"}`}>
              {!result && (
                <div className="mb-12 max-w-4xl">
                  <h1 className="font-display text-[clamp(44px,6.5vw,72px)]">
                    Lower fares.
                    <br />
                    <span className="text-charcoal">Sellers you can trust.</span>
                  </h1>
                  <p className="mt-6 max-w-xl text-[18px] leading-relaxed text-body">
                    Live prices from Google Flights, checked seller by seller. Every search also tries nearby airports, nearby dates and two one-way tickets, and leaves out agencies we haven&apos;t vetted.
                  </p>
                </div>
              )}
              <SearchForm
                form={form}
                onChange={setForm}
                onSubmit={() => search(form)}
                busy={busy}
                filters={{ alliances: prefs.alliances, avoidAirlines: prefs.avoidedAirlines }}
              />
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                {preferenceChips(prefs).map((c) => (
                  <Pill key={c}>{c}</Pill>
                ))}
                <button type="button" onClick={() => setPrefsDialog((d) => ({ open: true, key: d.key + 1 }))} className="cursor-pointer px-1 text-accent hover:underline pointer-coarse:min-h-11">
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
              <div className="space-y-3">
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
                  <section id="split" className="space-y-3 rounded-xl border border-hairline-strong bg-deep p-4">
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
        <div hidden={mode !== "stays"}>
          <Stays trustedOnly={trustedOnly} />
        </div>
        <div hidden={mode !== "ai"}>
          <section className="pt-12 sm:pt-16">
            <AiCanvas
              intro={
                <div className="mb-12 max-w-4xl pt-6 sm:pt-8">
                  <h1 className="font-display text-[clamp(40px,6vw,72px)]">
                    Say the trip.
                    <br />
                    <span className="text-charcoal">Get the shortlist.</span>
                  </h1>
                  <p className="mt-6 max-w-xl text-[18px] leading-relaxed text-body">
                    Your ChatGPT or Grok account plans several live searches at once (other airports, other days, other cabins), then lays the best options out with the reasons and the catches.
                  </p>
                </div>
              }
              defaults={{ homeAirports: prefs.homeAirports, cabin: prefs.cabin, stops: prefs.stops, adults: prefs.adults, bags: prefs.bags }}
              onSaveHome={(codes) => savePreferences({ ...prefs, homeAirports: codes })}
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
              signedIn={Boolean(account)}
              onSignIn={() => setAccountDialog((d) => ({ open: true, mode: "signin", key: d.key + 1 }))}
              onOpenTrips={(id) => {
                setFocusTrip(id);
                setMode("trips");
              }}
            />
          </section>
        </div>
        {account && mode === "trips" && (
          <Journeys
            provider={provider}
            onConnectAi={() => setConnectOpen(true)}
            pairFlint={pairFlint}
            onPairShown={onPairShown}
            watching={<Trips embedded focus={focusTrip} onPlan={() => setMode("ai")} checks={checks} onCheck={check} trustedOnly={trustedOnly} />}
          />
        )}
      </main>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-4 px-4 py-8 text-xs text-ash sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="space-y-1">
            <p>Live prices from Google Flights and Google Hotels. Lodestar doesn&apos;t sell tickets or rooms: you book with the airline, hotel or agency.</p>
            <p>Prices in USD, taxes included, per the seller at search time.</p>
          </div>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-2 text-charcoal hover:text-ink pointer-coarse:min-h-11">
            <GitHubMark size={14} /> Open source on GitHub · MIT
          </a>
        </div>
      </footer>

      <AgentAccess open={agentsOpen} onClose={() => setAgentsOpen(false)} />
      <ConfirmHost />
      <AccountDialog
        key={`account-${accountDialog.key}`}
        open={accountDialog.open}
        initialMode={accountDialog.mode}
        onClose={() => {
          // Closed without signing in: a later sign-up shouldn't jump to the link that asked.
          afterSignIn.current = null;
          setAccountDialog((d) => ({ ...d, open: false }));
        }}
        onSignedIn={signedIn}
        pendingPreferences={prefs}
      />
      <PreferencesDialog
        key={`prefs-${prefsDialog.key}`}
        open={prefsDialog.open}
        onClose={() => setPrefsDialog((d) => ({ ...d, open: false }))}
        value={prefs}
        signedIn={Boolean(account)}
        email={account?.email ?? null}
        onSave={savePreferences}
        onSignOut={signOut}
        aiName={provider ? PROVIDER_NAME[provider] : null}
        onDisconnectAi={() => provider && disconnect(provider)}
        onCreateAccount={(p) => {
          adoptPreferences(p, true);
          setAccountDialog((d) => ({ open: true, mode: "register", key: d.key + 1 }));
        }}
      />
      <Onboarding
        key={`onboarding-${onboarding.key}`}
        open={onboarding.open}
        initial={prefs}
        aiConnected={Boolean(provider)}
        onSave={savePreferences}
        onConnectAi={() => {
          tourAfterConnect.current = true;
          setOnboarding((o) => ({ ...o, open: false }));
          setConnectOpen(true);
        }}
        onDone={() => {
          setOnboarding((o) => ({ ...o, open: false }));
          setTouring(true);
        }}
      />
      {touring && <Tour steps={tourSteps(() => setMode("ai"))} onDone={() => setTouring(false)} />}
      <ConnectAI
        open={connectOpen}
        onClose={() => {
          setConnectOpen(false);
          if (tourAfterConnect.current) {
            tourAfterConnect.current = false;
            setTouring(true);
          }
        }} onConnected={() => refreshAi()} signedIn={Boolean(account)} />
    </>
  );
}
