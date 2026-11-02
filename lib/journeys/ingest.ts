import { randomUUID } from "node:crypto";
import type { Db, Queryable } from "../db/client";
import { insertMail, setMailState } from "../db/inbound";
import { journeyHeads, journeysForKeys, upsertItem, upsertJourney, widenJourney } from "../db/journeys";
import { dedupeKey, placeBatch, spanOf } from "./group";
import { cityForAirport, reservationsFromHtml } from "./jsonld";
import type { DraftItem, Source } from "./types";

// Every way mail reaches Trips (forwarding, Flint) ends here. Reservation
// markup is read at once; anything else waits, body kept, for the AI reader,
// which only runs when the traveller opens Trips with AI connected.

export const MAX_BODY_CHARS = 60_000;

export type IncomingMail = { source: "forward" | "flint"; messageId: string; from: string; subject: string; html: string | null; text: string | null };
export type IngestResult = { status: "duplicate" } | { status: "parsed"; items: number; journeyId: string | null } | { status: "needs_ai" };

const ENTITY: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };

/** Readable text from an HTML email: enough for a model to find dates, names and codes. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " \t ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (e.startsWith("#x")) return String.fromCodePoint(parseInt(e.slice(2), 16));
      if (e.startsWith("#")) return ENTITY[e] ?? String.fromCodePoint(Number(e.slice(1)));
      return ENTITY[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function mailBody(m: Pick<IncomingMail, "html" | "text">): string {
  const text = m.text?.trim() || (m.html ? htmlToText(m.html) : "");
  return text.slice(0, MAX_BODY_CHARS);
}

/**
 * Files a batch of items read from one email (or one import) into the right
 * trip: the one that already holds a booking, the one whose dates fit, a new
 * one for a flight or stay, or none ("Needs a trip").
 */
export async function fileItems(q: Queryable, userId: string, items: DraftItem[], source: Source, now: number): Promise<string | null> {
  if (!items.length) return null;
  const keys = items.map(dedupeKey);
  const existing = await journeysForKeys(q, userId, keys.filter((k): k is string => k !== null));
  const known = [...existing.values()].filter((id): id is string => id !== null);
  const placement = placeBatch(items, await journeyHeads(q, userId), known, cityForAirport);
  const journeyId =
    placement.action === "attach"
      ? placement.journeyId
      : placement.action === "create"
        ? await upsertJourney(q, userId, { id: randomUUID(), title: placement.title, destination: placement.destination, startDate: placement.span.start, endDate: placement.span.end, source, now })
        : null;
  for (const [i, item] of items.entries()) await upsertItem(q, userId, { id: randomUUID(), journeyId, source, dedupeKey: keys[i], item, now });
  const span = spanOf(items.filter((i) => i.status !== "cancelled"));
  if (journeyId && span) await widenJourney(q, userId, journeyId, span.start, span.end);
  return journeyId;
}

export async function ingestMail(db: Db, userId: string, mail: IncomingMail, now: number): Promise<IngestResult> {
  return db.transaction(async (tx) => {
    const id = await insertMail(tx, userId, { id: randomUUID(), source: mail.source, messageId: mail.messageId, sender: mail.from, subject: mail.subject, now });
    if (!id) return { status: "duplicate" } as const;
    const items = mail.html ? reservationsFromHtml(mail.html) : [];
    if (items.length) {
      const journeyId = await fileItems(tx, userId, items, mail.source === "flint" ? "flint" : "email", now);
      await setMailState(tx, userId, id, "parsed");
      return { status: "parsed", items: items.length, journeyId } as const;
    }
    const body = mailBody(mail);
    if (!body) {
      await setMailState(tx, userId, id, "ignored");
      return { status: "parsed", items: 0, journeyId: null } as const;
    }
    await setMailState(tx, userId, id, "needs_ai", `From: ${mail.from}\nSubject: ${mail.subject}\n\n${body}`);
    return { status: "needs_ai" } as const;
  });
}
