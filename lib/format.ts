// Formatting helpers shared by client components. Times from Google are local
// to each airport and carry no offset, so they are shown as written.

export function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}

export function clock(iso: string): string {
  const [h, m] = iso.slice(11, 16).split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")}${suffix}`;
}

/** Days between the departure date and the arrival date (for "+1"). */
export function dayShift(depart: string, arrive: string): number {
  return Math.round((Date.parse(arrive.slice(0, 10)) - Date.parse(depart.slice(0, 10))) / 86_400_000);
}

const DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
export function day(iso: string): string {
  return DAY.format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
