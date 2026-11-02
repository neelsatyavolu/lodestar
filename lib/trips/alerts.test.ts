import { describe, expect, it } from "vitest";
import { decideAlerts, isDue, type AlertState } from "./alerts";

const base: AlertState = {
  alertPrice: 1000,
  alertDrop: true,
  targetPrice: null,
  targetHit: false,
  remindOn: null,
  reminded: false,
  firstDepart: "2026-12-07",
};
const today = "2026-11-02";

describe("isDue", () => {
  it("checks trips with an active alert that haven't departed", () => {
    expect(isDue(base, today)).toBe(true);
    expect(isDue({ ...base, firstDepart: "2026-11-02" }, today)).toBe(false);
  });

  it("skips trips with every alert off or already used", () => {
    const off = { ...base, alertDrop: false };
    expect(isDue(off, today)).toBe(false);
    expect(isDue({ ...off, targetPrice: 800 }, today)).toBe(true);
    expect(isDue({ ...off, targetPrice: 800, targetHit: true }, today)).toBe(false);
    expect(isDue({ ...off, remindOn: "2026-11-20" }, today)).toBe(true);
    expect(isDue({ ...off, remindOn: "2026-11-20", reminded: true }, today)).toBe(false);
  });
});

describe("decideAlerts", () => {
  it("ignores small moves and alerts on a real drop, then measures from the new low", () => {
    expect(decideAlerts(base, 995, today).reasons).toEqual([]);
    const drop = decideAlerts(base, 900, today);
    expect(drop.reasons).toEqual(["drop"]);
    expect(drop.next.alertPrice).toBe(900);
    expect(decideAlerts({ ...base, alertPrice: 900 }, 1000, today).next.alertPrice).toBe(900);
  });

  it("fires the target once", () => {
    const withTarget = { ...base, alertDrop: false, targetPrice: 950 };
    expect(decideAlerts(withTarget, 960, today).reasons).toEqual([]);
    const hit = decideAlerts(withTarget, 940, today);
    expect(hit.reasons).toEqual(["target"]);
    expect(hit.next.targetHit).toBe(true);
    expect(decideAlerts({ ...withTarget, targetHit: true }, 900, today).reasons).toEqual([]);
  });

  it("sends a reminder on or after its date even without a fare", () => {
    const remind = { ...base, alertDrop: false, remindOn: "2026-11-02" };
    const r = decideAlerts(remind, null, today);
    expect(r.reasons).toEqual(["remind"]);
    expect(r.next.reminded).toBe(true);
    expect(decideAlerts({ ...remind, remindOn: "2026-11-03" }, null, today).reasons).toEqual([]);
  });

  it("combines reasons into one decision", () => {
    expect(decideAlerts({ ...base, targetPrice: 950, remindOn: today }, 900, today).reasons).toEqual(["drop", "target", "remind"]);
  });
});
