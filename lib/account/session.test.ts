import { describe, expect, it } from "vitest";
import { createSession, readSession, SESSION_TTL_MS, sessionKey } from "./session";

const key = sessionKey("a-long-enough-test-secret");
const user = "6f1c2b2e-1d2a-4c3b-9e8f-0a1b2c3d4e5f";

describe("sessions", () => {
  it("round-trips until it expires", () => {
    const token = createSession(key, user, 1000, 3);
    expect(readSession(key, token, 2000)).toEqual({ userId: user, version: 3 });
    expect(readSession(key, token, 1000 + SESSION_TTL_MS)).toBeNull();
  });

  it("rejects forged, tampered or foreign tokens", () => {
    const token = createSession(key, user, 1000, 0);
    expect(readSession(sessionKey("another-long-test-secret"), token, 2000)).toBeNull();
    const [, e, v, m] = token.split(".");
    expect(readSession(key, `00000000-0000-4000-8000-000000000000.${e}.${v}.${m}`, 2000)).toBeNull();
    expect(readSession(key, token.replace(/\.0\./, ".1."), 2000)).toBeNull();
    expect(readSession(key, "garbage", 2000)).toBeNull();
    expect(readSession(key, undefined, 2000)).toBeNull();
  });
});
