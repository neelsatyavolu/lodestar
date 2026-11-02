import { describe, expect, it } from "vitest";
import { airlineByCode, searchAirlines } from "./airline-search";

describe("airline search", () => {
  it("finds by code and by name, popular airlines first", () => {
    expect(searchAirlines("aa")[0].code).toBe("AA");
    expect(searchAirlines("american")[0].code).toBe("AA");
    expect(searchAirlines("delta")[0].code).toBe("DL");
    expect(searchAirlines("6e")[0].code).toBe("6E");
    expect(searchAirlines("")).toEqual([]);
  });

  it("uses current names", () => {
    expect(airlineByCode("AZ")?.name).toBe("ITA Airways");
    expect(airlineByCode("zz9")).toBeUndefined();
  });
});
