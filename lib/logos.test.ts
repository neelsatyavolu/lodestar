import { afterEach, describe, expect, it, vi } from "vitest";
import { imageResponse, initials, logo, monogram } from "./logos";

const png = (bytes: number) => new Response(new Uint8Array(bytes).fill(7), { headers: { "content-type": "image/png" } });

describe("monogram", () => {
  it("draws initials as SVG and escapes text", () => {
    expect(initials("FlightHub")).toBe("FL");
    expect(initials("Some Agency")).toBe("SA");
    expect(initials("AA")).toBe("AA");
    expect(initials("justfly.com")).toBe("JU");
    const svg = new TextDecoder().decode(monogram("<x> & y").body);
    expect(svg).toContain("<svg");
    expect(svg).not.toContain("<x>");
  });
});

describe("logo", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the first source that returns a real image", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("nope", { status: 404 })).mockResolvedValueOnce(png(500));
    vi.stubGlobal("fetch", fetchMock);
    const img = await logo("t1", ["https://a/x.png", "https://b/x.png"], "AA");
    expect(img.type).toBe("image/png");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to a monogram, remembers the miss, and draws the current name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("<html>", { headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetchMock);
    const img = await logo("t2", ["https://a/x.png"], "Zed Air");
    expect(img.type).toBe("image/svg+xml");
    const again = await logo("t2", ["https://a/x.png"], "Quux");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new TextDecoder().decode(again.body)).toContain(">QU<");
  });

  it("never passes an upstream SVG through", async () => {
    const svg = new Response("<svg onload=alert(1)>" + " ".repeat(200), { headers: { "content-type": "image/svg+xml" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(svg));
    const img = await logo("t4", ["https://a/x.svg"], "Evil");
    expect(new TextDecoder().decode(img.body)).not.toContain("onload");
  });

  it("serves with a locked-down policy", () => {
    const res = imageResponse(monogram("A"));
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toContain("max-age=600");
  });

  it("rejects tiny images and network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(png(10)).mockRejectedValueOnce(new Error("down")));
    const img = await logo("t3", ["https://a", "https://b"], "Q");
    expect(img.type).toBe("image/svg+xml");
  });
});
