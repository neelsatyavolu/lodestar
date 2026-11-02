import { describe, expect, it } from "vitest";
import { itin, leg, slice } from "../test-fixtures";
import { buildCandidates, describe as describeIt, describeDefaults, extractJson, parseCanvas, parsePlan, planSystemPrompt, toQuery } from "./canvas";

const plan = (searches: unknown[]) => JSON.stringify({ understanding: "Bay Area to NYC", assumptions: [], question: null, searches });
const search = { label: "Bay Area to NYC", from: ["sfo", "OAK"], to: ["JFK"], depart: "2026-12-10", return: "2026-12-15" };

describe("extractJson", () => {
  it("pulls JSON out of fenced or chatty text", () => {
    expect(extractJson('Sure!\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("parsePlan", () => {
  it("normalises codes and fills defaults", () => {
    const p = parsePlan(plan([search]), "2026-11-01");
    expect(p.searches[0].from).toEqual(["SFO", "OAK"]);
    expect(p.searches[0].cabin).toBe("ECONOMY");
    expect(p.searches[0].nearby).toBe(true);
  });

  it("drops past or backwards searches", () => {
    const p = parsePlan(plan([search, { ...search, depart: "2026-10-01" }, { ...search, return: "2026-12-01" }]), "2026-11-01");
    expect(p.searches).toHaveLength(1);
  });

  it("rejects bad airport codes", () => {
    expect(() => parsePlan(plan([{ ...search, from: ["San Francisco"] }]), "2026-11-01")).toThrow();
  });

  it("mentions today in the system prompt", () => {
    expect(planSystemPrompt("2026-11-01")).toContain("2026-11-01");
  });

  it("flags a missing origin only when the model says so", () => {
    expect(parsePlan(plan([search]), "2026-11-01").needsOrigin).toBe(false);
    const asked = parsePlan(JSON.stringify({ understanding: "", question: "Where from?", needsOrigin: true, searches: [] }), "2026-11-01");
    expect(asked).toMatchObject({ needsOrigin: true, searches: [] });
  });

  it("tells the model to fill gaps from saved defaults instead of asking", () => {
    const prompt = planSystemPrompt("2026-11-01");
    expect(prompt).toContain("needsOrigin");
    expect(prompt).toMatch(/home airports/i);
  });

  it("describes saved defaults, including when there is no home airport", () => {
    const withHome = describeDefaults({ homeAirports: ["SFO", "OAK"], cabin: "BUSINESS", stops: "ANY", adults: 2, bags: 1 });
    expect(withHome).toContain("home airports SFO, OAK");
    expect(withHome).toContain("2 adults");
    expect(withHome).toContain("business");
    expect(describeDefaults({ homeAirports: [], cabin: "ECONOMY", stops: "0", adults: 1, bags: 0 })).toContain("no home airport saved");
  });

  it("turns a planned search into a query", () => {
    const q = toQuery(parsePlan(plan([search]), "2026-11-01").searches[0]);
    expect(q).toMatchObject({ from: ["SFO", "OAK"], to: ["JFK"], split: true, flexible: false });
  });
});

describe("candidates and canvas", () => {
  const a = itin(250, [slice({ legs: [leg(), leg({ from: "ORD", to: "JFK" })], stops: 1, layovers: [{ airport: "ORD", city: null, minutes: 45, overnight: false, change_of_airport: false }], self_transfer: true })]);
  const b = itin(300);
  const outcomes = [
    { search: parsePlan(plan([search]), "2026-11-01").searches[0], itineraries: [a, b], hacks: [] },
    { search: parsePlan(plan([search]), "2026-11-01").searches[0], itineraries: [], hacks: [], error: "timeout" },
  ];

  it("numbers candidates and describes them compactly", () => {
    const { lines, refs } = buildCandidates(outcomes);
    expect([...refs.keys()]).toEqual(["S1-1", "S1-2"]);
    expect(lines).toContain("S1-1 $250");
    expect(lines).toContain("SELF-TRANSFER");
    expect(lines).toContain("ORD 45m");
    expect(lines).toContain("failed: timeout");
    expect(describeIt("X", b)).toContain("0 stops");
  });

  it("keeps only picks with real refs, once each", () => {
    const { refs } = buildCandidates(outcomes);
    const text = JSON.stringify({
      headline: "Fly OAK",
      picks: [
        { ref: "s1-2", title: "Nonstop", why: "Simple", tag: "best" },
        { ref: "S1-2", title: "dup", why: "dup" },
        { ref: "S9-9", title: "Made up", why: "Hallucinated" },
      ],
    });
    const canvas = parseCanvas(text, refs);
    expect(canvas.picks.map((p) => p.ref)).toEqual(["S1-2"]);
    expect(canvas.tips).toEqual([]);
  });
});
