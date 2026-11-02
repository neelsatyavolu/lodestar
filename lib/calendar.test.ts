import { describe, expect, it } from "vitest";
import { addDaysIso, addMonths, cheapestDay, dayOfMonth, monthGrid, monthLabel, nightsBetween, pick, shortLabel } from "./calendar";

describe("calendar math", () => {
  it("adds days and months across boundaries", () => {
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysIso("2026-03-08", 1)).toBe("2026-03-09"); // US DST start
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-01");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-01");
    expect(nightsBetween("2026-11-23", "2026-11-28")).toBe(5);
  });

  it("lays out a month Sunday first", () => {
    const weeks = monthGrid("2026-11-10"); // Nov 1 2026 is a Sunday
    expect(weeks[0][0]).toBe("2026-11-01");
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
    const feb = monthGrid("2027-02-01"); // Feb 1 2027 is a Monday
    expect(feb[0][0]).toBeNull();
    expect(feb[0][1]).toBe("2027-02-01");
  });

  it("formats labels", () => {
    expect(monthLabel("2026-11-23")).toBe("November 2026");
    expect(shortLabel("2026-11-23")).toBe("Mon, Nov 23");
    expect(dayOfMonth("2026-11-03")).toBe(3);
  });
});

describe("pick", () => {
  const range = { depart: "2026-11-23", return: "2026-11-28" };

  it("one way picks and closes", () => {
    expect(pick(range, "2026-11-25", "depart", false)).toEqual({ range: { depart: "2026-11-25", return: "2026-11-28" }, phase: "depart", done: true });
  });

  it("round trip: departure then return", () => {
    const first = pick(range, "2026-11-20", "depart", true);
    expect(first).toMatchObject({ range: { depart: "2026-11-20", return: "2026-11-28" }, phase: "return", done: false });
    const second = pick(first.range, "2026-11-26", first.phase, true);
    expect(second).toMatchObject({ range: { depart: "2026-11-20", return: "2026-11-26" }, done: true });
  });

  it("drops a return that would come before the new departure", () => {
    expect(pick(range, "2026-12-01", "depart", true).range.return).toBeNull();
  });

  it("restarts when the return is picked before the departure", () => {
    expect(pick(range, "2026-11-21", "return", true)).toMatchObject({ range: { depart: "2026-11-21", return: null }, phase: "return", done: false });
  });

  it("allows a same-day return", () => {
    expect(pick(range, "2026-11-23", "return", true).range.return).toBe("2026-11-23");
  });
});

describe("cheapestDay", () => {
  it("ignores days before the cutoff", () => {
    const prices = new Map([
      ["2026-11-20", 90],
      ["2026-11-24", 140],
      ["2026-11-25", 120],
    ]);
    expect(cheapestDay(prices, "2026-11-23")).toBe("2026-11-25");
    expect(cheapestDay(new Map(), "2026-11-23")).toBeNull();
  });
});
