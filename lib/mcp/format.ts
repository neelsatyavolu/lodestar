import { budget, issues, nights, toBook } from "../journeys/plan";
import type { Item, TripDetail } from "../journeys/types";

// Trips as text an agent can read at a glance. Every line that can be changed
// carries its id, so the agent can call update_* or remove_* on it.

const money = (n: number, currency: string) => `${currency === "USD" ? "$" : `${currency} `}${Math.round(n).toLocaleString("en-US")}`;
const span = (a: string | null, b: string | null) => (a ? (b && b !== a ? `${a} to ${b}` : a) : "dates not set");

function itemLine(i: Item): string {
  const d = i.details;
  const multiDay = Boolean(i.endDate && i.endDate !== i.startDate);
  const time = multiDay ? (i.startTime ?? "") : [i.startTime, i.endTime].filter(Boolean).join("–");
  const facts = [
    i.status,
    i.kind,
    i.place,
    multiDay ? `until ${i.endDate}${i.endTime ? ` ${i.endTime}` : ""}` : null,
    i.confirmation ? `conf ${i.confirmation}` : null,
    d.reserve && i.status === "planned" ? `needs booking${d.bookBy ? ` by ${d.bookBy}` : ""}` : null,
    d.price !== undefined ? `paid ${money(d.price, d.currency ?? "USD")}` : d.estimate !== undefined ? `est. ${money(d.estimate, d.currency ?? "USD")}` : null,
    d.phone,
    d.url,
  ].filter(Boolean);
  const note = d.note ? `\n      ${d.note.replace(/\n/g, "\n      ")}` : "";
  return `  - ${time ? `${time} ` : ""}${i.title} (${facts.join(", ")}) [item ${i.id}]${note}`;
}

/** The whole plan, tab by tab, as the trip page shows it. */
export function describeTrip(t: TripDetail, today: string): string {
  const out: string[] = [`# ${t.title} [trip ${t.id}]`, `${t.destination ?? "No destination"} · ${span(t.startDate, t.endDate)}${t.travelers ? ` · ${t.travelers} travellers` : ""}${t.tripType ? ` · ${t.tripType} trip` : ""}`];

  const problems = issues(t, today);
  if (problems.length) out.push("", "## Needs attention", ...problems.map((p) => `- ${p.text}`));

  const runs = nights(t);
  if (runs.length) out.push("", "## Where you sleep", ...runs.map((r) => `- ${r.from} to ${r.to} (${r.nights} night${r.nights === 1 ? "" : "s"}): ${r.stay ? r.stay.title : "nothing booked"}`));

  const live = t.items.filter((i) => i.status !== "suggested");
  const days = [...new Set(live.map((i) => i.startDate))].sort();
  out.push("", "## Itinerary");
  if (!days.length) out.push("Nothing planned yet.");
  for (const day of days) out.push(`- ${day}`, ...live.filter((i) => i.startDate === day).map(itemLine));
  const ideas = t.items.filter((i) => i.status === "suggested");
  if (ideas.length) out.push("", "## Ideas (suggested, not in the plan)", ...ideas.map(itemLine));

  const pending = toBook(t.items);
  if (pending.length) out.push("", "## To book", ...pending.map((i) => `- ${i.title} on ${i.startDate}${i.details.bookBy ? `, book by ${i.details.bookBy}` : ""} [item ${i.id}]`));

  if (t.tasks.length) out.push("", "## Checklist", ...t.tasks.map((x) => `- [${x.done ? "x" : " "}] ${x.title}${x.due ? ` (due ${x.due})` : ""} · ${x.section} [task ${x.id}]`));
  if (t.notes.length) out.push("", "## Notes", ...t.notes.flatMap((n) => [`### ${n.title} [note ${n.id}]`, n.body]));

  const b = budget(t);
  if (b.lines.length) {
    out.push("", `## Budget (${b.currency})`, ...b.lines.map((l) => `- ${l.category}: ${money(l.paid, b.currency)} paid, ${money(l.estimated, b.currency)} estimated`));
    out.push(`- Total ${money(b.total, b.currency)}${b.perPerson ? ` (${money(b.perPerson, b.currency)} a person)` : ""}${b.otherCurrencies.length ? `; not counted: entries in ${b.otherCurrencies.join(", ")}` : ""}`);
    if (t.costs.length) out.push(...t.costs.map((c) => `  - ${c.label}: ${money(c.amount, c.currency)} ${c.paid ? "paid" : "estimated"} · ${c.category} [cost ${c.id}]`));
  }
  return out.join("\n");
}
