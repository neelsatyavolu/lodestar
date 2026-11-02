import { fail } from "../api";

/** A stay that starts in the past can't be priced; say so before asking Google. */
export function pastCheckin(checkin: string, today = new Date().toISOString().slice(0, 10)): Response | null {
  return checkin < today ? fail("Pick a check-in date from today on.", 400) : null;
}
