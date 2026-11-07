import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import type { Db, Queryable } from "../db/client";
import {
  countItems, countJourneys, deleteItem, deleteJourney, getJourney, journeysForKeys, MAX_ITEMS, MAX_JOURNEYS, setShareToken, updateItem, updateJourney, upsertItem, upsertJourney, widenJourney, type ItemPatch, type JourneyPatch,
} from "../db/journeys";
import {
  addCost, addTasks, countCosts, countNotes, countTasks, deleteCost, deleteNote, deleteTask, MAX_PER_TRIP, putNote, updateCost, updateNote, updateTask, type CostPatch, type NewCost, type TaskPatch,
} from "../db/plan";
import { PlanError } from "../journeys/errors";
import { dedupeKey, journeyTitle } from "../journeys/group";
import { starterTasks } from "../journeys/plan";
import type { Cost, DraftItem, Item, Note, Source, Task, TripDetail, TripType } from "../journeys/types";

// Every change to a trip plan, whoever asks: the trip page (REST), an agent
// (MCP) or the traveller's AI. Callers have already validated the input with
// the schemas in lib/journeys/input; these check ownership and limits.

const NO_TRIP = "That trip doesn't exist.";

async function trip(q: Queryable, userId: string, id: string): Promise<TripDetail> {
  const t = await getJourney(q, userId, id);
  if (!t) throw new PlanError(NO_TRIP, 404);
  return t;
}

export async function loadTrip(db: Queryable, userId: string, id: string): Promise<TripDetail> {
  return trip(db, userId, id);
}

export type NewTrip = { destination: string; startDate: string | null; endDate: string | null; title?: string; travelers: number | null; tripType: TripType | null };

/** Starts a trip with the starter checklist. Returns its id. */
export async function createTrip(db: Db, userId: string, input: NewTrip, source: Source, now = Date.now()): Promise<string> {
  if ((await countJourneys(db, userId)) >= MAX_JOURNEYS) throw new PlanError(`You can keep ${MAX_JOURNEYS} trips. Delete an old one first.`, 409);
  return db.transaction(async (tx) => {
    const id = await upsertJourney(tx, userId, {
      id: randomUUID(),
      title: input.title ?? (input.startDate ? journeyTitle(input.destination, input.startDate) : input.destination),
      destination: input.destination,
      startDate: input.startDate,
      endDate: input.endDate ?? input.startDate,
      travelers: input.travelers,
      tripType: input.tripType,
      source,
      now,
    });
    await addTasks(tx, userId, id, starterTasks(input.tripType).map((t) => ({ id: randomUUID(), title: t.title, due: null, section: t.section, source: "manual" as const })), now);
    return id;
  });
}

export async function updateTrip(db: Queryable, userId: string, id: string, patch: JourneyPatch): Promise<TripDetail> {
  const current = await trip(db, userId, id);
  const start = patch.startDate === undefined ? current.startDate : patch.startDate;
  const end = patch.endDate === undefined ? current.endDate : patch.endDate;
  if (start && end && end < start) throw new PlanError("The trip ends before it starts.");
  await updateJourney(db, userId, id, patch, Date.now());
  return trip(db, userId, id);
}

export async function removeTrip(db: Queryable, userId: string, id: string): Promise<void> {
  if (!(await deleteJourney(db, userId, id))) throw new PlanError(NO_TRIP, 404);
}

// ---------- Items ----------

/** Adds items to a trip, stretching its dates to cover them. Returns the stored ids in order. */
export async function addItems(db: Db, userId: string, journeyId: string, items: DraftItem[], source: Source, now = Date.now()): Promise<string[]> {
  await trip(db, userId, journeyId);
  if ((await countItems(db, userId)) + items.length > MAX_ITEMS) throw new PlanError("This account has too many items. Delete some old trips first.", 409);
  return db.transaction(async (tx) => {
    const ids: string[] = [];
    for (const item of items) {
      // Added by hand or by an agent, it may only merge with the same booking in this trip, never pull one out of another trip.
      let key = dedupeKey(item);
      if (key) {
        const owner = (await journeysForKeys(tx, userId, [key])).get(key);
        if (owner !== undefined && owner !== journeyId) key = null;
      }
      ids.push(await upsertItem(tx, userId, { id: randomUUID(), journeyId, source, dedupeKey: key, item, now }));
      await widenJourney(tx, userId, journeyId, item.startDate, item.endDate ?? item.startDate);
    }
    return ids;
  });
}

export async function patchItem(db: Db, userId: string, itemId: string, patch: ItemPatch): Promise<Item> {
  const item = await db.transaction(async (tx) => {
    const updated = await updateItem(tx, userId, itemId, patch, Date.now());
    if (updated?.journeyId && updated.status !== "cancelled") await widenJourney(tx, userId, updated.journeyId, updated.startDate, updated.endDate ?? updated.startDate);
    return updated;
  });
  if (!item) throw new PlanError("That item doesn't exist.", 404);
  return item;
}

export async function removeItem(db: Queryable, userId: string, itemId: string): Promise<void> {
  if (!(await deleteItem(db, userId, itemId))) throw new PlanError("That item doesn't exist.", 404);
}

// ---------- Checklist ----------

async function room(n: Promise<number>, adding: number, what: string): Promise<void> {
  if ((await n) + adding > MAX_PER_TRIP) throw new PlanError(`A trip can hold ${MAX_PER_TRIP} ${what}.`, 409);
}

export async function addTripTasks(db: Db, userId: string, journeyId: string, tasks: { title: string; due: string | null; section: string }[], source: Source): Promise<Task[]> {
  await room(countTasks(db, userId, journeyId), tasks.length, "checklist items");
  const added = await db.transaction((tx) => addTasks(tx, userId, journeyId, tasks.map((t) => ({ ...t, id: randomUUID(), source })), Date.now()));
  if (!added) throw new PlanError(NO_TRIP, 404);
  return added;
}

export async function patchTask(db: Queryable, userId: string, id: string, patch: TaskPatch): Promise<Task> {
  const task = await updateTask(db, userId, id, patch);
  if (!task) throw new PlanError("That checklist item doesn't exist.", 404);
  return task;
}

export async function removeTask(db: Queryable, userId: string, id: string): Promise<void> {
  if (!(await deleteTask(db, userId, id))) throw new PlanError("That checklist item doesn't exist.", 404);
}

// ---------- Notes ----------

/** Writes a note, replacing one with the same title. */
export async function writeNote(db: Queryable, userId: string, journeyId: string, n: { title: string; body: string }, source: Source): Promise<Note> {
  await room(countNotes(db, userId, journeyId), 1, "notes");
  const note = await putNote(db, userId, journeyId, { id: randomUUID(), ...n, source }, Date.now());
  if (!note) throw new PlanError(NO_TRIP, 404);
  return note;
}

export async function patchNote(db: Queryable, userId: string, id: string, patch: Partial<{ title: string; body: string }>): Promise<Note> {
  const note = await updateNote(db, userId, id, patch);
  if (!note) throw new PlanError("That note doesn't exist.", 404);
  return note;
}

export async function removeNote(db: Queryable, userId: string, id: string): Promise<void> {
  if (!(await deleteNote(db, userId, id))) throw new PlanError("That note doesn't exist.", 404);
}

// ---------- Budget ----------

export async function addTripCost(db: Queryable, userId: string, journeyId: string, c: Omit<NewCost, "id" | "source">, source: Source): Promise<Cost> {
  await room(countCosts(db, userId, journeyId), 1, "budget lines");
  const cost = await addCost(db, userId, journeyId, { ...c, id: randomUUID(), source }, Date.now());
  if (!cost) throw new PlanError(NO_TRIP, 404);
  return cost;
}

export async function patchCost(db: Queryable, userId: string, id: string, patch: CostPatch): Promise<Cost> {
  const cost = await updateCost(db, userId, id, patch);
  if (!cost) throw new PlanError("That budget line doesn't exist.", 404);
  return cost;
}

export async function removeCost(db: Queryable, userId: string, id: string): Promise<void> {
  if (!(await deleteCost(db, userId, id))) throw new PlanError("That budget line doesn't exist.", 404);
}

// ---------- Sharing ----------

/** 32 base64url characters (192 bits): the share link's secret. */
export const newShareToken = () => randomBytes(24).toString("base64url");

/** Turns the read-only link on (keeping a link already out there) or off. Returns the token, or null when off. */
export async function setSharing(db: Queryable, userId: string, id: string, on: boolean): Promise<string | null> {
  const current = await trip(db, userId, id);
  if (on && current.shareToken) return current.shareToken;
  const token = on ? newShareToken() : null;
  if (!(await setShareToken(db, userId, id, token))) throw new PlanError(NO_TRIP, 404);
  return token;
}
