import { DraftItemSchema, type DraftItem } from "./types";

// Restaurant confirmations from Resy, OpenTable and Yelp carry no reservation
// markup, but each platform words them the same way every time, so they're
// read here without the traveller's AI. Works on forwards too: the patterns
// match the body, not the sender.

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DAY_MS = 86_400_000;

const pad = (n: number) => String(n).padStart(2, "0");

function clock(h: string, m: string, ampm: string): string {
  const hour = (Number(h) % 12) + (ampm.toLowerCase() === "pm" ? 12 : 0);
  return `${pad(hour)}:${m}`;
}

/** The date in `year`, or, with no year in the email, the first one on or after a month before it was sent. */
function isoDay(month: string, day: string, year: string | null, sentAt: number): string | null {
  const mo = MONTHS[month.toLowerCase().slice(0, 3)];
  const d = Number(day);
  if (!mo || d < 1 || d > 31) return null;
  let y = year ? Number(year) : new Date(sentAt).getUTCFullYear();
  if (!year && Date.UTC(y, mo - 1, d) < sentAt - 30 * DAY_MS) y += 1;
  // February 31 and the like: not a day, so not a booking.
  if (new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** "Tucson, AZ 85750" → "Tucson"; "Oro Valley AZ" → "Oro Valley"; "London W1D 4HS" stays as written. */
function cityOf(line: string): string {
  const us = line.match(/^(.+?),?\s+[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?$/);
  return (us ? us[1] : line.split(",")[0]).trim();
}

const PHONE = /^\+?[\d\s().-]{10,20}$/;

type Found = { title: string; date: string; time: string; guests: number; street?: string; cityLine?: string; phone?: string; url?: string; confirmation?: string; provider: string; cancelled: boolean };

function openTable(lines: string[], text: string): Found | null {
  const at = lines.findIndex((l) => /^(Table|Party) for \d+ (people )?on /i.test(l));
  if (at < 1 || !/OpenTable/i.test(text)) return null;
  const m = lines[at].match(/for (\d+) (?:people )?on \w+, (\w+) (\d{1,2}), (\d{4}) at (\d{1,2}):(\d{2}) ?([ap]m)/i);
  if (!m) return null;
  const date = isoDay(m[2], m[3], m[4], 0);
  if (!date) return null;
  // The address sits between "See menu | Get directions" and "Phone:".
  const dir = lines.findIndex((l, i) => i > at && /get directions/i.test(l));
  const phoneAt = lines.findIndex((l, i) => i > at && /^Phone\s*:/i.test(l));
  const address = dir > 0 && phoneAt > dir ? lines.slice(dir + 1, phoneAt) : [];
  return {
    title: lines[at - 1],
    date,
    time: clock(m[5], m[6], m[7]),
    guests: Number(m[1]),
    street: address[0],
    cityLine: address[address.length - 1],
    phone: phoneAt > 0 ? lines[phoneAt].replace(/^Phone\s*:\s*/i, "") : undefined,
    confirmation: text.match(/Confirmation #\s*:\s*([A-Z0-9-]{4,20})/i)?.[1],
    provider: "OpenTable",
    cancelled: /\[Reservation cancell?ed\]|^Reservation cancell?ed$/im.test(text),
  };
}

function resy(lines: string[], text: string, sentAt: number): Found | null {
  if (!/\bResy\b/.test(text)) return null;
  const at = lines.findIndex((l) => /^Reservation (booked|cancell?ed)\.?$/i.test(l));
  if (at < 0 || at + 3 >= lines.length) return null;
  const title = lines[at + 1];
  const m = lines[at + 2].match(/^\w{3},? (\w{3,5})\.? (\d{1,2})(?:, (\d{4}))? at (\d{1,2}):(\d{2}) ?([ap]m)$/i);
  const guests = lines[at + 3].match(/^(\d+) Guests?/i);
  if (!m || !guests) return null;
  const date = isoDay(m[1], m[2], m[3] ?? null, sentAt);
  if (!date) return null;
  // At the foot: the name again, the address, "Get Directions", the phone and the website.
  const dir = lines.findLastIndex((l) => /^Get Directions$/i.test(l));
  const nameAt = dir > 0 ? lines.lastIndexOf(title, dir) : -1;
  const address = nameAt >= 0 ? lines.slice(nameAt + 1, dir).filter((l) => !/^\(.*\)$/.test(l)) : [];
  const after = dir > 0 ? lines.slice(dir + 1, dir + 3) : [];
  return {
    title,
    date,
    time: clock(m[4], m[5], m[6]),
    guests: Number(guests[1]),
    street: address[0],
    cityLine: address.length > 1 ? address[address.length - 1] : undefined,
    phone: after.find((l) => PHONE.test(l)),
    url: after.find((l) => /^https?:\/\/\S+$/.test(l)),
    provider: "Resy",
    cancelled: /^Reservation cancel/i.test(lines[at]),
  };
}

function yelp(lines: string[], text: string, sentAt: number): Found | null {
  if (!/\bYelp\b/.test(text)) return null;
  const at = lines.findIndex((l) => /^Party of \d+$/i.test(l));
  if (at < 0 || at + 6 >= lines.length) return null;
  const day = lines[at + 1].match(/^\w+, (\w+) (\d{1,2})(?:, (\d{4}))?$/);
  const time = lines[at + 2].match(/^at (\d{1,2}):(\d{2}) ?([ap]m)$/i);
  if (!day || !time) return null;
  const date = isoDay(day[1], day[2], day[3] ?? null, sentAt);
  if (!date) return null;
  const phone = PHONE.test(lines[at + 6]) ? lines[at + 6] : undefined;
  return {
    title: lines[at + 3],
    date,
    time: clock(time[1], time[2], time[3]),
    guests: Number(lines[at].replace(/\D/g, "")),
    street: lines[at + 4],
    cityLine: lines[at + 5],
    phone,
    provider: "Yelp",
    cancelled: /reservation (has been )?cancell?ed/i.test(text),
  };
}

/**
 * The table booked in a Resy, OpenTable or Yelp confirmation, or null when
 * the email isn't one. `sentAt` places dates the email gives without a year.
 */
export function restaurantReservation(text: string, sentAt: number): DraftItem | null {
  const lines = text.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const found = openTable(lines, text) ?? resy(lines, text, sentAt) ?? yelp(lines, text, sentAt);
  if (!found) return null;
  const city = found.cityLine ? cityOf(found.cityLine) : null;
  const parsed = DraftItemSchema.safeParse({
    kind: "dining",
    status: found.cancelled ? "cancelled" : "booked",
    title: found.title,
    startDate: found.date,
    startTime: found.time,
    place: city,
    confirmation: found.confirmation ?? null,
    details: {
      provider: found.provider,
      ...(found.guests >= 1 && found.guests <= 30 ? { guests: found.guests } : {}),
      ...(found.street && found.cityLine ? { address: `${found.street}, ${found.cityLine}` } : {}),
      ...(found.phone ? { phone: found.phone } : {}),
      ...(found.url ? { url: found.url } : {}),
    },
  });
  return parsed.success ? parsed.data : null;
}
