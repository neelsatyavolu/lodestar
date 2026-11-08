import { z } from "zod";
import type { Db } from "../db/client";
import { listJourneys } from "../db/journeys";
import { PlanError } from "../journeys/errors";
import { CostPatchSchema, ItemPatchSchema, JourneyPatchSchema, NewCostSchema, NewItemSchema, NewJourneySchema, NewTaskSchema, NoteSchema, TaskPatchSchema } from "../journeys/input";
import { budget, issues, nights, toBook } from "../journeys/plan";
import {
  addItems, addTripCost, addTripTasks, createTrip, loadTrip, patchCost, patchItem, patchTask, removeCost, removeItem, removeNote, removeTask, removeTrip, updateTrip, writeNote,
} from "../server/plan-ops";
import { describeTrip } from "./format";

// The Trips tools agents call over MCP. Each is a plain function of the
// database and the account the token acts for, so they're testable without
// HTTP; lib/mcp/server.ts registers them. Every write goes through plan-ops,
// the same code the trip page uses, and is marked as made by an agent.

export type ToolResult = { text: string; data?: Record<string, unknown> };
export type ToolCtx = { db: Db; userId: string; today: string };

type Annotations = { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };

export type ToolDef<S extends z.ZodObject = z.ZodObject> = {
  name: string;
  title: string;
  description: string;
  input: S;
  annotations: Annotations;
  run: (ctx: ToolCtx, args: z.output<S>) => Promise<ToolResult>;
};

const tool = <S extends z.ZodObject>(def: ToolDef<S>): ToolDef => def as unknown as ToolDef;

const Id = (what: string) => z.uuid().describe(`The ${what}'s id, from get_trip.`);
const TripId = z.uuid().describe("The trip's id, from list_trips or create_trip.");

const PLANNING_GUIDE = `How a good Lodestar plan is built:
- Itinerary: add_items with one item per thing on its day, with startTime when it has one. Kinds: flight, stay (startDate = check-in, endDate = check-out), dining, activity, transport, note.
- Day notes: anything that isn't a place, like when to leave, a drive, parking, free time or a tip, is kind "note" with a startTime. It sits between the stops by that time, shows its time, and isn't a stop. Don't make an activity for it: a drive card has no place to pin and gets in the way of the drive times. Lodestar works out and shows the drive between consecutive stops on its own.
- Booked vs planned: status "booked" only for things already reserved (put the code in confirmation and the cost in details.price). Everything else is "planned".
- To book: a planned item that needs a reservation gets details.reserve = true and details.bookBy (the last sensible day to book), plus details.url or details.phone so the traveller can book it.
- Budget: details.estimate for expected costs of planned items; add_cost for spending that isn't an item (gas, resort fees, tips).
- Checklist: add_tasks for things to do before leaving (documents, packing, reservations without a date).
- Trip notes: set_note for context worth reading first, like "How the trip works", "Getting around" or "Dietary needs".
Dates are YYYY-MM-DD and times HH:MM (24-hour, local to where it happens).`;

export const TOOLS: ToolDef[] = [
  tool({
    name: "list_trips",
    title: "List trips",
    description: "Every trip in the traveller's Lodestar account, soonest first, with ids. Start here, then call get_trip.",
    input: z.object({}),
    annotations: { readOnlyHint: true },
    run: async ({ db, userId }) => {
      const { journeys, unfiled } = await listJourneys(db, userId);
      const trips = journeys.map((j) => ({ id: j.id, title: j.title, destination: j.destination, startDate: j.startDate, endDate: j.endDate, travelers: j.travelers, items: j.items.length }));
      const lines = trips.map((t) => `- ${t.title} · ${t.destination ?? "no destination"} · ${t.startDate ?? "no dates"}${t.endDate && t.endDate !== t.startDate ? ` to ${t.endDate}` : ""} · ${t.items} items [trip ${t.id}]`);
      const text = trips.length ? lines.join("\n") : "No trips yet. Use create_trip to start one.";
      return { text: unfiled.length ? `${text}\n\n${unfiled.length} bookings from email are waiting to be filed into a trip.` : text, data: { trips } };
    },
  }),
  tool({
    name: "get_trip",
    title: "Get a trip",
    description: "One trip in full: itinerary by day, where each night is spent, what still needs booking, the checklist, notes, the budget and anything that needs attention (missing stays, overdue bookings, clashes). Ids for every item, task, note and cost are included.",
    input: z.object({ tripId: TripId }),
    annotations: { readOnlyHint: true },
    run: async ({ db, userId, today }, { tripId }) => {
      const trip = await loadTrip(db, userId, tripId);
      return { text: describeTrip(trip, today), data: { trip, toBook: toBook(trip.items).map((i) => i.id), nights: nights(trip).map((r) => ({ ...r, stay: r.stay?.id ?? null })), budget: budget(trip), issues: issues(trip, today) } };
    },
  }),
  tool({
    name: "create_trip",
    title: "Create a trip",
    description: `Starts a new trip. It comes with a short starter checklist. Then fill it in with add_items, add_tasks, set_note and add_cost.\n\n${PLANNING_GUIDE}`,
    input: NewJourneySchema,
    annotations: {},
    run: async ({ db, userId, today }, input) => {
      const id = await createTrip(db, userId, input, "agent");
      return { text: `Created the trip [trip ${id}].\n\n${describeTrip(await loadTrip(db, userId, id), today)}`, data: { tripId: id } };
    },
  }),
  tool({
    name: "update_trip",
    title: "Update a trip",
    description: "Changes a trip's title, destination, dates, number of travellers or kind of trip. Send only what changes; null clears a field.",
    input: z.object({ tripId: TripId, changes: JourneyPatchSchema }),
    annotations: { idempotentHint: true },
    run: async ({ db, userId }, { tripId, changes }) => {
      const t = await updateTrip(db, userId, tripId, changes);
      return { text: `Updated ${t.title}: ${t.destination ?? "no destination"}, ${t.startDate ?? "?"} to ${t.endDate ?? "?"}.`, data: { tripId } };
    },
  }),
  tool({
    name: "delete_trip",
    title: "Delete a trip",
    description: "Deletes a trip and everything in it: items, checklist, notes and budget. This can't be undone; only do it when the traveller asks.",
    input: z.object({ tripId: TripId }),
    annotations: { destructiveHint: true },
    run: async ({ db, userId }, { tripId }) => {
      await removeTrip(db, userId, tripId);
      return { text: "Deleted the trip." };
    },
  }),
  tool({
    name: "add_items",
    title: "Add to the itinerary",
    description: `Adds up to 50 flights, stays, meals, activities, transfers or notes to a trip's days. The trip's dates stretch to cover them.\n\n${PLANNING_GUIDE}`,
    input: z.object({ tripId: TripId, items: z.array(NewItemSchema).min(1).max(50) }),
    annotations: {},
    run: async ({ db, userId }, { tripId, items }) => {
      const ids = await addItems(db, userId, tripId, items, "agent");
      return { text: `Added ${ids.length} ${ids.length === 1 ? "item" : "items"}:\n${items.map((i, n) => `- ${i.startDate} ${i.title} [item ${ids[n]}]`).join("\n")}`, data: { itemIds: ids } };
    },
  }),
  tool({
    name: "update_item",
    title: "Update an item",
    description:
      "Edits an itinerary item. To mark something booked: status \"booked\", confirmation, and facts.price. To put it on the To book list: facts.reserve true and facts.bookBy. facts sets booking details (reserve, bookBy, estimate, price, currency, url, phone, address); null clears one. note replaces the item's note.",
    input: z.object({ itemId: Id("item"), changes: ItemPatchSchema }),
    annotations: { idempotentHint: true },
    run: async ({ db, userId }, { itemId, changes }) => {
      const item = await patchItem(db, userId, itemId, changes);
      return { text: `Updated ${item.title} (${item.status}) on ${item.startDate}.`, data: { item } };
    },
  }),
  tool({
    name: "remove_item",
    title: "Remove an item",
    description: "Removes an item from the itinerary. To keep a record of a cancelled booking instead, update_item with status \"cancelled\".",
    input: z.object({ itemId: Id("item") }),
    annotations: { destructiveHint: true, idempotentHint: true },
    run: async ({ db, userId }, { itemId }) => {
      await removeItem(db, userId, itemId);
      return { text: "Removed it." };
    },
  }),
  tool({
    name: "add_tasks",
    title: "Add to the checklist",
    description: 'Adds up to 50 checklist items. Group them with section, like "Before you go", "Packing", "Documents" or "Bookings"; due is an optional YYYY-MM-DD.',
    input: z.object({ tripId: TripId, tasks: z.array(NewTaskSchema).min(1).max(50) }),
    annotations: {},
    run: async ({ db, userId }, { tripId, tasks }) => {
      const added = await addTripTasks(db, userId, tripId, tasks, "agent");
      return { text: `Added ${added.length} to the checklist:\n${added.map((t) => `- ${t.title} [task ${t.id}]`).join("\n")}`, data: { taskIds: added.map((t) => t.id) } };
    },
  }),
  tool({
    name: "update_task",
    title: "Update a checklist item",
    description: "Ticks off (done: true) or edits a checklist item.",
    input: z.object({ taskId: Id("task"), changes: TaskPatchSchema }),
    annotations: { idempotentHint: true },
    run: async ({ db, userId }, { taskId, changes }) => {
      const t = await patchTask(db, userId, taskId, changes);
      return { text: `${t.done ? "Done" : "To do"}: ${t.title}.`, data: { task: t } };
    },
  }),
  tool({
    name: "remove_task",
    title: "Remove a checklist item",
    description: "Removes a checklist item. To tick one off, use update_task with done: true.",
    input: z.object({ taskId: Id("task") }),
    annotations: { destructiveHint: true, idempotentHint: true },
    run: async ({ db, userId }, { taskId }) => {
      await removeTask(db, userId, taskId);
      return { text: "Removed it from the checklist." };
    },
  }),
  tool({
    name: "set_note",
    title: "Write a note",
    description: 'Writes a titled note on the trip\'s overview, like "How the trip works", "Getting around" or "Dietary needs". A note with the same title is replaced, so call it again to revise one.',
    input: NoteSchema.extend({ tripId: TripId }),
    annotations: { idempotentHint: true },
    run: async ({ db, userId }, { tripId, title, body }) => {
      const n = await writeNote(db, userId, tripId, { title, body }, "agent");
      return { text: `Saved the note "${n.title}" [note ${n.id}].`, data: { noteId: n.id } };
    },
  }),
  tool({
    name: "remove_note",
    title: "Remove a note",
    description: "Removes a note from the trip's overview.",
    input: z.object({ noteId: Id("note") }),
    annotations: { destructiveHint: true, idempotentHint: true },
    run: async ({ db, userId }, { noteId }) => {
      await removeNote(db, userId, noteId);
      return { text: "Removed the note." };
    },
  }),
  tool({
    name: "add_cost",
    title: "Add a budget line",
    description: "Adds spending that isn't an itinerary item, like gas, parking, resort fees or tips. Costs of items belong on the item (details.price when booked, details.estimate when planned).",
    input: NewCostSchema.extend({ tripId: TripId }),
    annotations: {},
    run: async ({ db, userId }, { tripId, ...cost }) => {
      const c = await addTripCost(db, userId, tripId, cost, "agent");
      return { text: `Added ${c.label} to the budget [cost ${c.id}].`, data: { costId: c.id } };
    },
  }),
  tool({
    name: "update_cost",
    title: "Update a budget line",
    description: "Edits a budget line, or marks it paid.",
    input: z.object({ costId: Id("cost"), changes: CostPatchSchema }),
    annotations: { idempotentHint: true },
    run: async ({ db, userId }, { costId, changes }) => {
      const c = await patchCost(db, userId, costId, changes);
      return { text: `Updated ${c.label}.`, data: { cost: c } };
    },
  }),
  tool({
    name: "remove_cost",
    title: "Remove a budget line",
    description: "Removes a budget line added with add_cost.",
    input: z.object({ costId: Id("cost") }),
    annotations: { destructiveHint: true, idempotentHint: true },
    run: async ({ db, userId }, { costId }) => {
      await removeCost(db, userId, costId);
      return { text: "Removed it from the budget." };
    },
  }),
];

/** Runs a tool with already-validated arguments. Refusals the agent can act on come back as error text, not exceptions. */
export async function runTool(def: ToolDef, ctx: ToolCtx, args: unknown): Promise<{ ok: true; result: ToolResult } | { ok: false; message: string }> {
  try {
    return { ok: true, result: await def.run(ctx, def.input.parse(args)) };
  } catch (err) {
    if (err instanceof PlanError) return { ok: false, message: err.message };
    if (err instanceof z.ZodError) return { ok: false, message: err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") };
    throw err;
  }
}
