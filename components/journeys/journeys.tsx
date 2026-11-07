import { CalendarClock, Download, Mail, Plus, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, post } from "@/lib/client";
import { toBook } from "@/lib/journeys/plan";
import type { Item } from "@/lib/journeys/types";
import type { Provider } from "../connect-ai";
import { Button, Spinner } from "../ui";
import { EmailDialog, FlintDialog, WanderlogDialog } from "./connect-dialogs";
import { ItemRow } from "./item-row";
import { JourneyDetail } from "./journey-detail";
import { NewTripDialog, type DraftRequest } from "./quick-start";
import { countdown, dateRange, deadline, errorText, isPast, shortDate, tally, time12, travellers, type Overview, type PlanTrip } from "./shared";
import { readLocation } from "./tabs";

// Trips: every trip, past and upcoming, built mostly from confirmations that
// arrive by forwarding or through Flint. Plan shortlists with fare alerts sit
// below as "Watching fares".

type DialogName = "new" | "email" | "flint" | "wanderlog" | null;

export function Journeys({ provider, onConnectAi, pairFlint, onPairShown, watching }: { provider: Provider | null; onConnectAi: () => void; pairFlint: boolean; onPairShown: () => void; watching: ReactNode }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A reload with ?trip=<id> in the address lands back on that trip.
  const [openId, setOpenId] = useState<string | null>(() => readLocation().trip);
  const [autoDraft, setAutoDraft] = useState<{ id: string; draft: DraftRequest } | null>(null);
  const clearAutoDraft = useCallback(() => setAutoDraft(null), []);
  // Arriving from Flint's pairing link opens straight to the Connect Flint steps.
  const [dialog, setDialog] = useState<DialogName>(pairFlint ? "flint" : null);
  const [arrivedFromFlint] = useState(pairFlint);
  const [dialogKey, setDialogKey] = useState(0);
  const [reading, setReading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // The provider the waiting mail was last read with; a newly connected AI tries again.
  const readWith = useRef<Provider | null>(null);

  const load = useCallback(
    () =>
      api<Overview>("/api/journeys")
        .then(setData)
        .catch((err) => setError(errorText(err, "Couldn't load your trips."))),
    [],
  );

  useEffect(() => {
    api<Overview>("/api/journeys")
      .then(setData)
      .catch((err) => setError(errorText(err, "Couldn't load your trips.")));
  }, []);

  const show = useCallback((d: DialogName) => {
    setDialogKey((k) => k + 1);
    setDialog(d);
  }, []);

  useEffect(() => {
    if (pairFlint) onPairShown();
  }, [pairFlint, onPairShown]);

  const waiting = data?.mail.filter((m) => m.state === "needs_ai") ?? [];

  // Mail without booking markup is read by the traveller's AI here, on their visit.
  const readWaiting = useCallback(
    async (p: Provider) => {
      readWith.current = p;
      setReading(true);
      setNotice(null);
      let filed = 0;
      try {
        for (let round = 0; round < 4; round++) {
          const r = await post<{ read: number; filed: number; error: string | null }>("/api/journeys/read", { provider: p });
          filed += r.filed;
          if (r.error) setNotice(r.error);
          if (!r.read || r.error) break;
        }
      } catch (err) {
        setNotice(errorText(err, "Couldn't read your waiting emails."));
      } finally {
        setReading(false);
        if (filed) setNotice(`Added ${filed} ${filed === 1 ? "booking" : "bookings"} from your email.`);
        load();
      }
    },
    [load],
  );

  useEffect(() => {
    if (!provider || !waiting.length || readWith.current === provider) return;
    // Started from a timer so the effect itself sets no state.
    const t = setTimeout(() => readWaiting(provider), 0);
    return () => clearTimeout(t);
  }, [provider, waiting.length, readWaiting]);

  const updateJourney = useCallback((id: string, update: (j: PlanTrip) => PlanTrip) => setData((d) => (d ? { ...d, journeys: d.journeys.map((x) => (x.id === id ? update(x) : x)) } : d)), []);
  const opened = data?.journeys.find((j) => j.id === openId) ?? null;

  if (opened)
    return (
      <JourneyDetail
        key={opened.id}
        journey={opened}
        provider={provider}
        onConnectAi={onConnectAi}
        autoDraft={autoDraft?.id === opened.id ? autoDraft.draft : null}
        onAutoDraftStarted={clearAutoDraft}
        onBack={() => setOpenId(null)}
        onChanged={(update) => updateJourney(opened.id, update)}
        onDeleted={() => {
          setOpenId(null);
          load();
        }}
      />
    );

  const upcoming = (data?.journeys ?? []).filter((j) => !isPast(j));
  const past = (data?.journeys ?? []).filter((j) => isPast(j)).reverse();
  const failed = data?.mail.filter((m) => m.state === "failed") ?? [];

  const fileItem = async (item: Item, journeyId: string) => {
    try {
      await api(`/api/journeys/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ journeyId }) });
      load();
    } catch (err) {
      setError(errorText(err, "Couldn't move it."));
    }
  };

  const forgetMail = async (id: string) => {
    try {
      await api(`/api/journeys/mail/${id}`, { method: "DELETE" });
      setData((d) => (d ? { ...d, mail: d.mail.filter((m) => m.id !== id) } : d));
    } catch (err) {
      setError(errorText(err, "Couldn't remove it."));
    }
  };

  return (
    <section className="pt-10 sm:pt-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[clamp(32px,5vw,48px)] tracking-[-0.02em]">Trips</h1>
          <p className="mt-3 max-w-xl text-[16px] leading-relaxed text-body">Plan any trip day by day, with what to book, a checklist and a budget. Forward a confirmation or connect Flint and bookings file themselves.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => show("new")}>
            <Plus size={14} /> Plan a trip
          </Button>
          <Button variant="ghost" onClick={() => show("email")}>
            <Mail size={14} /> Add by email
          </Button>
          <Button variant="ghost" onClick={() => show("flint")}>
            Connect Flint
          </Button>
          <Button variant="ghost" onClick={() => show("wanderlog")}>
            <Download size={14} /> Wanderlog
          </Button>
        </div>
      </div>

      <div className="mt-8 space-y-10">
        {error && <p className="text-[13px] text-danger">{error}</p>}
        {notice && <p className="rounded-lg border border-hairline-strong bg-card px-4 py-3 text-[13px] text-body">{notice}</p>}
        {!data && !error && <p className="text-[13px] text-mute">Loading…</p>}

        {(waiting.length > 0 || failed.length > 0) && (
          <div className="rounded-lg border border-hairline-strong bg-card p-4 text-[14px]">
            {waiting.length > 0 &&
              (reading ? (
                <p className="flex items-center gap-2 text-body">
                  <Spinner /> Reading {waiting.length} {waiting.length === 1 ? "email" : "emails"} with your AI…
                </p>
              ) : provider ? (
                <p className="text-body">
                  {waiting.length} {waiting.length === 1 ? "email is" : "emails are"} waiting to be read.{" "}
                  <button type="button" onClick={() => readWaiting(provider)} className="cursor-pointer text-accent hover:underline">
                    Read now
                  </button>
                </p>
              ) : (
                <p className="text-body">
                  {waiting.length} {waiting.length === 1 ? "email has" : "emails have"} no booking details built in.{" "}
                  <button type="button" onClick={onConnectAi} className="cursor-pointer text-accent hover:underline">
                    Connect ChatGPT or Grok
                  </button>{" "}
                  to read {waiting.length === 1 ? "it" : "them"}.
                </p>
              ))}
            {[...waiting, ...failed].length > 0 && (
              <ul className="mt-2 space-y-1">
                {[...waiting, ...failed].map((m) => (
                  <li key={m.id} className="flex items-center gap-2 text-[13px] text-mute">
                    <span className="min-w-0 flex-1 truncate">
                      {m.subject || "(no subject)"} <span className="text-ash">· {m.sender}</span>
                      {m.state === "failed" && <span className="text-danger"> · {m.error ?? "Couldn't be read"}</span>}
                    </span>
                    <button type="button" onClick={() => forgetMail(m.id)} aria-label={`Forget ${m.subject}`} className="inline-flex size-7 cursor-pointer items-center justify-center text-ash hover:text-ink">
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {data && data.unfiled.length > 0 && (
          <div>
            <h2 className="text-[13px] font-medium text-ink">Needs a trip</h2>
            <p className="mt-1 text-[13px] text-mute">These didn&apos;t clearly belong to one trip. Choose where they go.</p>
            <div className="mt-3 space-y-1">
              {data.unfiled.map((item) => (
                <div key={item.id} className="flex flex-wrap items-start gap-2 sm:flex-nowrap">
                  <ul className="min-w-0 flex-1">
                    <ItemRow item={item} onChanged={() => load()} onRemoved={() => load()} />
                  </ul>
                  <select
                    aria-label={`Trip for ${item.title}`}
                    defaultValue=""
                    onChange={(e) => e.target.value && fileItem(item, e.target.value)}
                    className="mt-2 h-9 max-w-56 rounded-md border border-hairline-strong bg-deep px-2 text-[13px] text-ink"
                  >
                    <option value="">Move to…</option>
                    {data.journeys.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.title}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {data && data.journeys.length === 0 && (
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { title: "Forward a confirmation", body: "Send any flight, hotel or restaurant email to your private address.", act: () => show("email"), label: "Get the address" },
              { title: "Connect Flint", body: "New travel mail files itself, and the last year's comes in when you connect.", act: () => show("flint"), label: "Connect" },
              { title: "Bring Wanderlog trips", body: "Import past and upcoming trips with their flights, hotels and plans.", act: () => show("wanderlog"), label: "Import" },
            ].map((c) => (
              <div key={c.title} className="flex flex-col rounded-lg border border-hairline-strong bg-card p-5">
                <h3 className="text-[15px] font-medium text-ink">{c.title}</h3>
                <p className="mt-1.5 flex-1 text-[13px] text-mute">{c.body}</p>
                <button type="button" onClick={c.act} className="mt-4 cursor-pointer self-start text-[13px] text-accent hover:underline">
                  {c.label}
                </button>
              </div>
            ))}
          </div>
        )}

        {upcoming.length > 0 && (
          <div>
            <h2 className="mb-3 text-[13px] font-medium text-ink">Upcoming</h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {upcoming.map((j) => (
                <JourneyCard key={j.id} journey={j} onOpen={() => setOpenId(j.id)} />
              ))}
            </ul>
          </div>
        )}

        {watching}

        {past.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer text-[13px] font-medium text-ink marker:text-ash">Past trips ({past.length})</summary>
            <ul className="mt-3 divide-y divide-hairline rounded-lg border border-hairline-strong">
              {past.map((j) => (
                <li key={j.id}>
                  <button type="button" onClick={() => setOpenId(j.id)} className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left hover:bg-elevated">
                    <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{j.title}</span>
                    <span className="shrink-0 text-[12px] text-ash">{dateRange(j.startDate, j.endDate)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <NewTripDialog
        key={`new-${dialogKey}`}
        open={dialog === "new"}
        onClose={() => setDialog(null)}
        provider={provider}
        onConnectAi={onConnectAi}
        onCreated={(id, draft) => {
          setDialog(null);
          if (draft) setAutoDraft({ id, draft });
          load().then(() => setOpenId(id));
        }}
      />
      <EmailDialog key={`email-${dialogKey}`} open={dialog === "email"} onClose={() => setDialog(null)} />
      <FlintDialog key={`flint-${dialogKey}`} open={dialog === "flint"} fromFlint={dialogKey === 0 && arrivedFromFlint} onClose={() => setDialog(null)} />
      <WanderlogDialog
        key={`wl-${dialogKey}`}
        open={dialog === "wanderlog"}
        onClose={() => setDialog(null)}
        onImported={(n) => {
          setDialog(null);
          setNotice(`Imported ${n} ${n === 1 ? "trip" : "trips"} from Wanderlog.`);
          load();
        }}
      />
    </section>
  );
}

function JourneyCard({ journey, onOpen }: { journey: PlanTrip; onOpen: () => void }) {
  const when = countdown(journey);
  const next = journey.items.find((i) => (i.status === "booked" || i.status === "planned") && i.startDate >= new Date().toLocaleDateString("en-CA"));
  const open = toBook(journey.items);
  const due = deadline(open[0]?.details.bookBy);
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex h-full w-full cursor-pointer flex-col rounded-xl border border-hairline-strong bg-card p-5 text-left transition-colors duration-150 hover:border-hairline-hover">
        <div className="flex w-full items-baseline justify-between gap-3">
          <h3 className="min-w-0 truncate text-[17px] font-medium text-ink">{journey.title}</h3>
          {when && <span className="shrink-0 text-[12px] text-accent">{when}</span>}
        </div>
        <p className="tnum mt-1 flex flex-wrap items-center gap-x-3 text-[13px] text-mute">
          <span>{dateRange(journey.startDate, journey.endDate)}</span>
          {journey.travelers && (
            <span className="inline-flex items-center gap-1">
              <Users size={12} aria-hidden /> {travellers(journey.travelers)}
            </span>
          )}
        </p>
        <p className="mt-3 text-[13px] text-body">{tally(journey.items)}</p>
        {open.length > 0 && (
          <p className={`mt-1 inline-flex items-center gap-1.5 text-[12px] ${due?.tone === "danger" ? "text-danger" : due?.tone === "warn" ? "text-warn" : "text-mute"}`}>
            <CalendarClock size={12} aria-hidden />
            {open.length} to book{open[0].details.bookBy ? ` · next by ${shortDate(open[0].details.bookBy)}` : ""}
          </p>
        )}
        {next && (
          <p className="mt-1 truncate text-[12px] text-ash">
            Next: {next.title}
            {next.startTime ? ` at ${time12(next.startTime)}` : ""}
          </p>
        )}
      </button>
    </li>
  );
}
