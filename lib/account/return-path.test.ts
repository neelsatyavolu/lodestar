import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./return-path";

const ORIGIN = "https://lodestar.example";

describe("the path to return to after signing in", () => {
  it("keeps paths on this site", () => {
    expect(safeReturnPath("/oauth/authorize?client_id=x&state=y", ORIGIN)).toBe("/oauth/authorize?client_id=x&state=y");
  });

  it("refuses anything the browser would read as another site", () => {
    for (const next of ["//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "https://evil.example", "javascript:alert(1)", "evil.example", "", null]) {
      expect(safeReturnPath(next, ORIGIN)).toBeNull();
    }
  });
});
