import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { api, post } from "@/lib/client";
import type { ConnectorLink } from "@/lib/db/inbound";
import type { WanderlogTrip } from "@/lib/journeys/wanderlog";
import { Dialog, Field, inputClass } from "../dialog";
import { Button, Spinner } from "../ui";
import { dateRange, errorText } from "./shared";
import { askConfirm } from "../confirm";

// The three ways trips come in besides typing: a private forwarding address,
// Flint (pairs once, then sends travel mail on its own) and a Wanderlog import.

type Connections = { address: string | null; flint: ConnectorLink[] };

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })
      }
    >
      {done ? <Check size={14} /> : <Copy size={14} />} {done ? "Copied" : "Copy"}
    </Button>
  );
}

function useConnections(open: boolean) {
  const [data, setData] = useState<Connections | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    api<Connections>("/api/connectors")
      .then(setData)
      .catch((err) => setError(errorText(err, "Couldn't load your connections.")));
  }, [open]);
  return { data, setData, error, setError };
}

export function EmailDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, setData, error, setError } = useConnections(open);
  const rotate = async () => {
    if (!(await askConfirm("Make a new address?", "Make new address", "Mail sent to the old one will stop reaching Trips."))) return;
    try {
      const { address } = await post<{ address: string }>("/api/connectors/address", {});
      setData((d) => (d ? { ...d, address } : d));
    } catch (err) {
      setError(errorText(err, "Couldn't make a new address."));
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Add trips by email">
      <div className="space-y-4 p-5 text-[14px] text-body">
        <p>Forward any flight, hotel, restaurant or tour confirmation to your private address. Lodestar files it in the right trip, or starts one. A table you already planned, say dinner at Penca on the 21st, becomes that booking instead of a second stop.</p>
        {!data && !error && <Spinner />}
        {data?.address && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline-strong bg-deep p-3">
            <code className="min-w-0 flex-1 break-all font-mono text-[13px] text-ink">{data.address}</code>
            <CopyButton text={data.address} />
          </div>
        )}
        {data && !data.address && <p className="text-mute">Forwarding isn&apos;t set up on this server yet.</p>}
        <p className="text-[13px] text-mute">Confirmations with booking details built in, and Resy, OpenTable and Yelp tables, are filed at once. Others are read by your ChatGPT or Grok the next time you open Trips. The address is private: anyone who has it can add to your trips.</p>
        {error && <p className="text-[13px] text-danger">{error}</p>}
        {data?.address && (
          <button type="button" onClick={rotate} className="cursor-pointer text-[13px] text-charcoal hover:text-ink">
            Make a new address
          </button>
        )}
      </div>
    </Dialog>
  );
}

export function FlintDialog({ open, onClose, fromFlint = false }: { open: boolean; onClose: () => void; fromFlint?: boolean }) {
  const { data, setData, error, setError } = useConnections(open);
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const appUrl = typeof window === "undefined" ? "" : window.location.origin;

  // Flint opened this page to ask for a code: step 1 is done, so show one straight away.
  useEffect(() => {
    if (!open || !fromFlint) return;
    post<{ code: string; expiresAt: number }>("/api/connectors/flint/code", {})
      .then(setCode)
      .catch((err) => setError(errorText(err, "Couldn't make a code.")));
  }, [open, fromFlint, setError]);

  const getCode = async () => {
    setBusy(true);
    setError(null);
    try {
      setCode(await post<{ code: string; expiresAt: number }>("/api/connectors/flint/code", {}));
    } catch (err) {
      setError(errorText(err, "Couldn't make a code."));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (id: string) => {
    try {
      await api(`/api/connectors/flint/${id}`, { method: "DELETE" });
      setData((d) => (d ? { ...d, flint: d.flint.filter((l) => l.id !== id) } : d));
    } catch (err) {
      setError(errorText(err, "Couldn't disconnect."));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Connect Flint">
      <div className="space-y-5 p-5 text-[14px] text-body">
        <p>Flint sends your travel confirmations here as they arrive, and the last year&apos;s when you connect. Only mail from travel companies, or mail with booking details built in, leaves your Mac. Flint shows you how many messages match before anything is sent.</p>
        <ol className="space-y-4">
          <li className="flex gap-3">
            <span className="font-mono text-[12px] text-ash">1</span>
            <div className="min-w-0 flex-1 space-y-2">
              <p>In Flint, open Settings › Connected apps › Add app and paste:</p>
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline-strong bg-deep p-3">
                <code className="min-w-0 flex-1 break-all font-mono text-[13px] text-ink">{appUrl}</code>
                <CopyButton text={appUrl} />
              </div>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-[12px] text-ash">2</span>
            <div className="min-w-0 flex-1 space-y-2">
              <p>When Flint asks for a code, type this one. It works once, for 10 minutes.</p>
              {code ? (
                <p className="font-mono text-[28px] tracking-[0.06em] text-ink">{code.code}</p>
              ) : (
                <Button variant="primary" disabled={busy} onClick={getCode}>
                  {busy && <Spinner />} Get a code
                </Button>
              )}
            </div>
          </li>
        </ol>
        {error && <p className="text-[13px] text-danger">{error}</p>}
        {data && data.flint.length > 0 && (
          <div className="border-t border-hairline pt-4">
            <h3 className="mb-2 text-[13px] font-medium text-ink">Connected</h3>
            <ul className="space-y-2">
              {data.flint.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 text-[13px]">
                  <span>
                    {l.deviceName}
                    <span className="text-ash"> · {l.lastDeliveryAt ? `last sent ${new Date(l.lastDeliveryAt).toLocaleDateString()}` : "nothing sent yet"}</span>
                  </span>
                  <Button size="sm" variant="quiet" onClick={() => disconnect(l.id)}>
                    Disconnect
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function WanderlogDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: (n: number) => void }) {
  const [session, setSession] = useState("");
  const [trips, setTrips] = useState<WanderlogTrip[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = async () => {
    setBusy(true);
    setError(null);
    try {
      const { trips: found } = await post<{ trips: WanderlogTrip[] }>("/api/journeys/import/wanderlog", { session });
      setTrips(found);
      setPicked(new Set(found.slice(0, 50).map((t) => t.key)));
    } catch (err) {
      setError(errorText(err, "Couldn't reach Wanderlog."));
    } finally {
      setBusy(false);
    }
  };

  const importPicked = async () => {
    setBusy(true);
    setError(null);
    try {
      const { imported } = await post<{ imported: number }>("/api/journeys/import/wanderlog", { session, keys: [...picked] });
      setSession("");
      onImported(imported);
    } catch (err) {
      setError(errorText(err, "The import didn't finish. Try again; trips already imported won't be doubled."));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (key: string) => setPicked((s) => (s.has(key) ? new Set([...s].filter((k) => k !== key)) : new Set([...s, key])));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Import from Wanderlog"
      width={560}
      footer={
        <div className="flex items-center justify-end gap-2">
          {error && <p className="mr-auto text-[13px] text-danger">{error}</p>}
          {trips ? (
            <Button variant="primary" disabled={busy || picked.size === 0} onClick={importPicked}>
              {busy && <Spinner />} Import {picked.size} {picked.size === 1 ? "trip" : "trips"}
            </Button>
          ) : (
            <Button variant="primary" disabled={busy || session.trim().length < 10} onClick={list}>
              {busy && <Spinner />} Find my trips
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4 p-5 text-[14px] text-body">
        {!trips ? (
          <>
            <p>Wanderlog doesn&apos;t let other apps sign in for you, so Lodestar borrows your signed-in session once to read your trips. It isn&apos;t saved.</p>
            <ol className="list-decimal space-y-1 pl-5 text-[13px] text-mute">
              <li>Open wanderlog.com in this browser and sign in.</li>
              <li>Open developer tools (⌥⌘I on a Mac), then Application › Cookies › wanderlog.com.</li>
              <li>Copy the value of <code className="font-mono text-ink">connect.sid</code> and paste it below.</li>
            </ol>
            <Field label="Wanderlog session">
              <input value={session} onChange={(e) => setSession(e.target.value)} placeholder="s%3A…" className={`${inputClass} font-mono`} autoComplete="off" spellCheck={false} />
            </Field>
          </>
        ) : trips.length === 0 ? (
          <p>That Wanderlog account has no trips.</p>
        ) : (
          <>
            <p className="text-[13px] text-mute">Flights, hotels and places you put on a day come across. Lists and notes stay in Wanderlog. Importing again updates the same trips.</p>
            <ul className="divide-y divide-hairline rounded-lg border border-hairline-strong">
              {trips.map((t) => (
                <li key={t.key}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                    <input type="checkbox" checked={picked.has(t.key)} onChange={() => toggle(t.key)} className="size-4 accent-[var(--accent)]" />
                    <span className="min-w-0 flex-1 truncate text-ink">{t.title}</span>
                    <span className="shrink-0 text-[12px] text-ash">{dateRange(t.startDate, t.endDate)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Dialog>
  );
}
