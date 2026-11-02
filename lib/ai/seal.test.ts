import { describe, expect, it } from "vitest";
import { deriveKey, seal, unseal } from "./seal";

const key = deriveKey("a-long-enough-test-secret", "ai-session");

describe("seal", () => {
  it("round-trips and hides the plaintext", () => {
    const s = seal(key, '{"accessToken":"secret"}', "codex:user-1");
    expect(s).not.toContain("secret");
    expect(unseal(key, s, "codex:user-1")).toBe('{"accessToken":"secret"}');
  });

  it("rejects another user, provider, key or a tampered value", () => {
    const s = seal(key, "x", "codex:user-1");
    expect(unseal(key, s, "codex:user-2")).toBeNull();
    expect(unseal(key, s, "grok:user-1")).toBeNull();
    expect(unseal(deriveKey("a-different-test-secret!", "ai-session"), s, "codex:user-1")).toBeNull();
    const flipped = s.slice(0, -2) + (s.endsWith("A") ? "B" : "A") + s.slice(-1);
    expect(unseal(key, flipped, "codex:user-1")).toBeNull();
    expect(unseal(key, '{"plain":true}', "codex:user-1")).toBeNull();
  });

  it("derives different keys per label", () => {
    expect(deriveKey("a-long-enough-test-secret", "a").equals(deriveKey("a-long-enough-test-secret", "b"))).toBe(false);
  });
});
