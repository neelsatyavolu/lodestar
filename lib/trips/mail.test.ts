import { describe, expect, it } from "vitest";
import { tripAlertEmail, tripLink } from "./mail";

const base = { title: "SFO → MAA · Dec 7 – Dec 20", cheapest: 1650, previous: 1822, target: 1700, url: "https://lodestar.xanom.co/?trip=abc" };

describe("trip alert email", () => {
  it("explains a drop that also met the target", () => {
    const m = tripAlertEmail({ ...base, reasons: ["drop", "target"] });
    expect(m.subject).toBe("$1,650: SFO → MAA · Dec 7 – Dec 20");
    expect(m.text).toContain("fell to $1,650, down from $1,822");
    expect(m.text).toContain("under your $1,700 target");
    expect(m.html).toContain("?trip=abc");
  });

  it("sends a reminder even when fares couldn't be fetched", () => {
    const m = tripAlertEmail({ ...base, cheapest: null, reasons: ["remind"] });
    expect(m.subject).toBe("Reminder: book SFO → MAA · Dec 7 – Dec 20");
    expect(m.text).toContain("check today's fares");
  });

  it("links to the trip on the configured site", () => {
    expect(tripLink("https://lodestar.xanom.co", "abc")).toBe("https://lodestar.xanom.co/?trip=abc");
  });

  it("says how far a booked fare fell below what was paid and whether credit comes back", () => {
    const booking = { tfs: "CBwQAhoeEgoyMDI2LTEyLTA3", seller: "United", isAirline: true, fare: "Economy", paid: 1822, changes: "free" as const, refunds: "none" as const };
    const m = tripAlertEmail({ ...base, target: null, reasons: ["drop"], booking });
    expect(m.subject).toBe("$172 cheaper since you booked: SFO → MAA · Dec 7 – Dec 20");
    expect(m.text).toContain("The Economy fare you booked with United is now $1,650, down from the $1,822 you paid.");
    expect(m.text).toContain("keep the difference as travel credit");
  });
});
