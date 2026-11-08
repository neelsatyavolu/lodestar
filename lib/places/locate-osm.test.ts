import { describe, expect, it } from "vitest";
import { locateWithOsm } from "./locate-osm";
import type { Search } from "./resolve";
import type { Suggestion } from "./types";

const ids = { pizza: "00000000-0000-4000-8000-00000000000a", spa: "00000000-0000-4000-8000-00000000000b", flight: "00000000-0000-4000-8000-00000000000c", down: "00000000-0000-4000-8000-00000000000d" };
const phoenix = { lat: 33.45, lng: -112.07 };
const row = (name: string, location = phoenix): Suggestion => ({ id: `osm:N${name.length}`, name, secondary: "Phoenix, AZ", address: null, location, kind: "dining" }) as Suggestion;

const search: Search = async (q) => {
  if (q.startsWith("Down")) throw new Error("503");
  if (q === "Phoenix") return [row("Phoenix")];
  if (q.startsWith("Pizzeria Bianco")) return [row("Pizzeria Bianco", { lat: 33.449, lng: -112.066 })];
  return [];
};

describe("pinning items with OpenStreetMap", () => {
  it("pins what it finds, marks what it can't, and leaves an errored search for later", async () => {
    const out = await locateWithOsm(
      [
        { id: ids.flight, location: { lat: 32.11, lng: -110.94 } },
        { id: ids.pizza, title: "Pizzeria Bianco", address: "623 E Adams St, Phoenix, AZ 85004", city: "Phoenix" },
        { id: ids.spa, title: "Spa for the parents", address: null, city: "Phoenix" },
        { id: ids.down, title: "Down the road", address: null, city: "Phoenix" },
      ],
      search,
      10_000,
    );
    expect(out.found).toEqual([
      { id: ids.flight, lat: 32.11, lng: -110.94 },
      { id: ids.pizza, placeId: "osm:N15", lat: 33.449, lng: -112.066 },
    ]);
    expect(out.failed).toEqual([ids.spa]);
  });
});
