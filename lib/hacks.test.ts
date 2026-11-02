import { describe, expect, it } from "vitest";
import {
  allOn,
  bestScore,
  cabinHack,
  flexHack,
  groupHack,
  isRedEye,
  lengthHack,
  matchesRequest,
  nearbyHack,
  nextCabin,
  nonstopHack,
  positionHack,
  rank,
  splitHack,
  stopoverHack,
  throwawayHack,
  timingHack,
  ulccWarning,
} from "./hacks";
import { itin, leg, route, slice } from "./test-fixtures";

describe("matchesRequest", () => {
  it("checks both directions of a round trip", () => {
    const rt = itin(300, [route("SFO", "JFK"), route("JFK", "SFO")]);
    expect(matchesRequest(rt, ["SFO"], ["JFK"])).toBe(true);
    const openJaw = itin(300, [route("SFO", "JFK"), route("EWR", "SFO")]);
    expect(matchesRequest(openJaw, ["SFO"], ["JFK"])).toBe(false);
  });
});

describe("rank", () => {
  it("labels cheapest, fastest and best", () => {
    const cheapSlow = itin(200, [slice({ legs: [leg({ minutes: 300 }), leg({ from: "ORD", minutes: 300 })], stops: 1 })], "cheap");
    const fastPricey = itin(400, [slice({ legs: [leg({ minutes: 330 })] })], "fast");
    const balanced = itin(230, [slice({ legs: [leg({ minutes: 340 })] })], "balanced");
    const { ordered, labels } = rank([cheapSlow, fastPricey, balanced]);
    expect(labels.cheapest).toBe("cheap");
    expect(labels.fastest).toBe("fast");
    expect(labels.best).toBe("balanced");
    expect(ordered[0].id).toBe("balanced");
  });

  it("handles empty input", () => {
    expect(rank([])).toEqual({ ordered: [], labels: {} });
  });

  it("penalises self-transfers", () => {
    const normal = itin(300, [slice()]);
    const self = itin(300, [slice({ self_transfer: true })]);
    expect(bestScore(self, 330)).toBeGreaterThan(bestScore(normal, 330));
  });
});

describe("nearbyHack", () => {
  const km = () => 18;
  it("suggests a nearby airport when it saves enough", () => {
    const items = [itin(300, [route("SFO", "JFK")]), itin(240, [route("OAK", "JFK")], "oak")];
    const hack = nearbyHack(items, ["SFO"], ["JFK"], km);
    expect(hack?.saving).toBe(60);
    expect(hack?.itineraryIds).toEqual(["oak"]);
    expect(hack?.title).toContain("OAK");
    expect(hack?.detail).toContain("18 km");
  });

  it("stays quiet for tiny savings", () => {
    const items = [itin(300, [route("SFO", "JFK")]), itin(295, [route("OAK", "JFK")])];
    expect(nearbyHack(items, ["SFO"], ["JFK"], km)).toBeNull();
  });

  it("stays quiet without a fare from the requested airports", () => {
    expect(nearbyHack([itin(240, [route("OAK", "EWR")])], ["SFO"], ["JFK"], () => null)).toBeNull();
  });

  it("notices a different airport on the way back only", () => {
    const items = [itin(400, [route("SFO", "JFK"), route("JFK", "SFO")]), itin(300, [route("SFO", "JFK"), route("EWR", "SFO")])];
    expect(nearbyHack(items, ["SFO"], ["JFK"], () => 15)?.title).toBe("Use EWR instead");
  });

  it("names both airports when both ends change", () => {
    const items = [itin(300, [route("SFO", "JFK")]), itin(200, [route("OAK", "EWR")])];
    const hack = nearbyHack(items, ["SFO"], ["JFK"], () => null);
    expect(hack?.title).toContain("OAK and EWR");
    expect(hack?.detail).toContain("OAK; EWR");
  });
});

describe("flexHack", () => {
  const days = [
    { depart: "2026-12-08", return: "2026-12-13", price: 250 },
    { depart: "2026-12-10", return: "2026-12-15", price: 320 },
    { depart: "2026-12-11", return: "2026-12-16", price: 310 },
  ];
  it("finds the cheaper nearby date and the matching return", () => {
    const hack = flexHack(days, "2026-12-10", "2026-12-15", 320);
    expect(hack?.saving).toBe(70);
    expect(hack?.apply).toEqual({ depart: "2026-12-08", return: "2026-12-13" });
    expect(hack?.title).toBe("Leave 2 days earlier");
  });

  it("shifts the return itself for one-way calendars", () => {
    const oneWay = days.map((d) => ({ ...d, return: null }));
    expect(flexHack(oneWay, "2026-12-10", null, 320)?.apply).toEqual({ depart: "2026-12-08", return: null });
  });

  it("uses the baseline when the chosen date is missing", () => {
    expect(flexHack([days[0]], "2026-12-10", null, 300)?.saving).toBe(50);
    expect(flexHack([days[0]], "2026-12-10", null, null)).toBeNull();
  });

  it("returns null when the chosen date is already cheapest", () => {
    expect(flexHack([{ depart: "2026-12-10", return: null, price: 100 }, days[2]], "2026-12-10", null, 100)).toBeNull();
    expect(flexHack([], "2026-12-10", null, 100)).toBeNull();
  });

  it("says later when the cheaper day is after", () => {
    const later = [
      { depart: "2026-12-10", return: null, price: 300 },
      { depart: "2026-12-11", return: null, price: 200 },
    ];
    expect(flexHack(later, "2026-12-10", null, 300)?.title).toBe("Go 1 day later");
  });
});

describe("splitHack", () => {
  it("prefers two one-ways when cheaper", () => {
    const rt = [itin(400, [route("SFO", "JFK"), route("JFK", "SFO")])];
    const out = [itin(150, [route("SFO", "JFK")], "o")];
    const back = [itin(170, [route("JFK", "SFO", { airline: { code: "B6", name: "JetBlue" } })], "b")];
    const hack = splitHack(rt, out, back);
    expect(hack?.saving).toBe(80);
    expect(hack?.itineraryIds).toEqual(["o", "b"]);
    expect(hack?.caution).toBeTruthy();
  });

  it("stays quiet when the round trip is cheaper", () => {
    expect(splitHack([itin(300)], [itin(200)], [itin(200)])).toBeNull();
    expect(splitHack([itin(300)], [], [itin(200)])).toBeNull();
  });
});

describe("nonstopHack and ulccWarning", () => {
  it("offers a nonstop when it costs a little more and saves time", () => {
    const connecting = itin(200, [slice({ legs: [leg({ minutes: 300 }), leg({ from: "ORD", minutes: 200 })], stops: 1 })]);
    const nonstop = itin(240, [slice({ legs: [leg({ minutes: 330 })] })], "ns");
    const hack = nonstopHack([connecting, nonstop]);
    expect(hack?.saving).toBe(-40);
    expect(hack?.itineraryIds).toEqual(["ns"]);
    expect(nonstopHack([nonstop])).toBeNull();
  });

  it("flags no-frills airlines", () => {
    const spirit = itin(99, [route("SFO", "JFK", { airline: { code: "NK", name: "Spirit" } })]);
    expect(ulccWarning([spirit])?.kind).toBe("ulcc");
    expect(ulccWarning([itin(200)])).toBeNull();
    expect(ulccWarning([])).toBeNull();
  });
});

describe("preferences in ranking", () => {
  it("spots red-eyes by local departure time", () => {
    const redEye = itin(200, [route("LAX", "JFK", { depart: "2026-12-10T22:30:00", arrive: "2026-12-11T06:55:00" })]);
    const early = itin(200, [route("LAX", "JFK", { depart: "2026-12-10T04:30:00", arrive: "2026-12-10T12:55:00" })]);
    const lateSameDay = itin(200, [route("LAX", "SFO", { depart: "2026-12-10T21:30:00", arrive: "2026-12-10T23:00:00" })]);
    const daytime = itin(200, [route("LAX", "JFK", { depart: "2026-12-10T08:00:00", arrive: "2026-12-10T16:30:00" })]);
    expect(isRedEye(redEye)).toBe(true);
    expect(isRedEye(early)).toBe(true);
    expect(isRedEye(lateSameDay)).toBe(false);
    expect(isRedEye(daytime)).toBe(false);
  });

  it("ranks preferred airlines higher", () => {
    const united = itin(320, [route("SFO", "JFK", { airline: { code: "UA", name: "United" } })], "ua");
    const american = itin(300, [route("SFO", "JFK", { airline: { code: "AA", name: "American" } })], "aa");
    expect(rank([united, american]).labels.best).toBe("aa");
    expect(rank([united, american], new Set(["UA"])).labels.best).toBe("ua");
    expect(allOn(united, new Set())).toBe(false);
  });
});

describe("extra-search hacks", () => {
  const nonstop = (price: number, id: string, over = {}) => itin(price, [route("SFO", "JFK", over)], id);

  it("offers the next cabin when the gap is small", () => {
    const hack = cabinHack([nonstop(300, "y")], [nonstop(360, "pe")], "ECONOMY");
    expect(hack?.title).toBe("Premium economy for $60 more");
    expect(hack?.apply).toEqual({ cabin: "PREMIUM_ECONOMY" });
    expect(cabinHack([nonstop(300, "y")], [nonstop(900, "j")], "ECONOMY")).toBeNull();
    expect(cabinHack([nonstop(300, "f")], [nonstop(310, "x")], "FIRST")).toBeNull();
    expect(nextCabin("BUSINESS")).toBe("FIRST");
  });

  it("suggests driving to a bigger airport only for real savings", () => {
    const hub = itin(200, [route("SMF", "JFK")], "smf");
    expect(positionHack(300, [hub], () => 140)?.title).toBe("Start from SMF");
    expect(positionHack(300, [hub], () => 140)?.apply).toEqual({ from: ["SMF"] });
    expect(positionHack(250, [hub], () => 140)).toBeNull();
    expect(positionHack(null, [hub], () => 140)).toBeNull();
  });

  it("finds a cheaper return day", () => {
    const hack = lengthHack(400, [{ ret: "2026-12-14", items: [itin(390)] }, { ret: "2026-12-16", items: [itin(320, undefined, "later")] }], "2026-12-15");
    expect(hack?.title).toBe("Come back a day later");
    expect(hack?.apply).toEqual({ return: "2026-12-16" });
    expect(lengthHack(400, [{ ret: "2026-12-16", items: [] }], "2026-12-15")).toBeNull();
  });

  it("splits a group when single seats are cheaper", () => {
    const hack = groupHack([itin(900)], [itin(380)], 2);
    expect(hack?.saving).toBe(140);
    expect(hack?.apply).toEqual({ adults: 1 });
    expect(groupHack([itin(740)], [itin(370)], 2)).toBeNull();
    expect(groupHack([itin(900)], [itin(300)], 1)).toBeNull();
  });

  it("notices when a round trip undercuts the one-way", () => {
    const hack = throwawayHack([itin(450)], [itin(300, [route("SFO", "JFK"), route("JFK", "SFO")])], "2026-12-17");
    expect(hack?.saving).toBe(150);
    expect(hack?.caution).toMatch(/Never skip an outbound/);
    expect(throwawayHack([itin(300)], [itin(290)], "2026-12-17")).toBeNull();
  });
});

describe("result-only hacks", () => {
  it("prices the overnight flight against the cheapest daytime one", () => {
    const red = itin(200, [route("LAX", "JFK", { depart: "2026-12-10T23:00:00", arrive: "2026-12-11T07:30:00" })], "red");
    const day = itin(260, [route("LAX", "JFK", { depart: "2026-12-10T09:00:00", arrive: "2026-12-10T17:30:00" })], "day");
    expect(timingHack([red, day])?.saving).toBe(60);
    expect(timingHack([day])).toBeNull();
    expect(timingHack([red])).toBeNull();
  });

  it("spots a connection that qualifies for a stopover program", () => {
    const viaKef = itin(450, [slice({ legs: [leg({ from: "BOS", to: "KEF", airline: { code: "FI", name: "Icelandair" } }), leg({ from: "KEF", to: "CDG", airline: { code: "FI", name: "Icelandair" } })], stops: 1 })]);
    const hack = stopoverHack([viaKef]);
    expect(hack?.title).toBe("Turn the Reykjavik connection into a stay");
    expect(hack?.detail).toMatch(/up to 7 nights/);
    const otherAirline = itin(450, [slice({ legs: [leg({ from: "BOS", to: "KEF", airline: { code: "PL", name: "PLAY" } }), leg({ from: "KEF", to: "CDG" })], stops: 1 })]);
    expect(stopoverHack([otherAirline])).toBeNull();
    expect(stopoverHack([itin(300)])).toBeNull();
  });
});
