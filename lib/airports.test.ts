import { describe, expect, it } from "vitest";
import { airport, distanceKm, expandCode, nearbyAirports, searchAirports } from "./airports";

describe("airports", () => {
  it("looks up by code", () => {
    expect(airport("sfo")?.city).toBe("San Francisco");
    expect(airport("QQQ")).toBeUndefined();
  });

  it("expands metro codes but keeps LAX the airport", () => {
    expect(expandCode("NYC")).toEqual(["JFK", "EWR", "LGA"]);
    expect(expandCode("LAX")).toEqual(["LAX"]);
    expect(expandCode("QQQ")).toEqual([]);
  });

  it("measures distance", () => {
    const sfo = airport("SFO")!;
    const oak = airport("OAK")!;
    expect(distanceKm(sfo, oak)).toBeGreaterThan(10);
    expect(distanceKm(sfo, oak)).toBeLessThan(30);
  });

  it("finds Bay Area airports near SFO", () => {
    const codes = nearbyAirports(["SFO"]).map((a) => a.code);
    expect(codes).toContain("OAK");
    expect(codes).toContain("SJC");
    expect(codes).not.toContain("SFO");
    expect(codes).not.toContain("SMF");
    expect(nearbyAirports(["JFK"]).map((a) => a.code)).not.toContain("TEB");
    expect(nearbyAirports(["QQQ"])).toEqual([]);
  });

  it("suggests by code, city and metro", () => {
    expect(searchAirports("jfk")[0].code).toBe("JFK");
    expect(searchAirports("new york").some((s) => s.code === "NYC" && s.metro)).toBe(true);
    expect(searchAirports("londo")[0].code).toBe("LON");
    expect(searchAirports("zürich").some((s) => s.code === "ZRH")).toBe(true);
    expect(searchAirports("  ")).toEqual([]);
  });
});
