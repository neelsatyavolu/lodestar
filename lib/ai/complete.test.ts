import { afterEach, describe, expect, it, vi } from "vitest";
import { complete, parseEvent, sseLines, upstreamError } from "./complete";

describe("parseEvent", () => {
  it("reads deltas, completion and errors", () => {
    expect(parseEvent('{"type":"response.output_text.delta","delta":"Hi"}')).toEqual({ delta: "Hi" });
    expect(parseEvent('{"type":"response.completed"}')).toEqual({ done: true });
    expect(parseEvent("[DONE]")).toEqual({ done: true });
    expect(parseEvent('{"type":"response.failed","response":{"error":{"message":"quota"}}}')).toEqual({ error: "quota" });
    expect(parseEvent('{"type":"error","message":"bad"}')).toEqual({ error: "bad" });
    expect(parseEvent('{"type":"response.created"}')).toBeNull();
    expect(parseEvent("not json")).toBeNull();
  });
});

describe("sseLines", () => {
  it("joins events split across chunks", () => {
    const out: string[] = [];
    const p = sseLines((d) => out.push(d));
    p.push("data: {\"a\"");
    p.push(":1}\n\ndata: two\r\n\n");
    p.push("data: three");
    p.flush();
    expect(out).toEqual(['{"a":1}', "two", "three"]);
  });
});

describe("upstreamError", () => {
  it("prefers the provider's message", () => {
    expect(upstreamError(400, '{"error":{"message":"model not found"}}')).toBe("model not found");
    expect(upstreamError(401, "")).toMatch(/expired/);
    expect(upstreamError(429, "")).toMatch(/rate limit/);
    expect(upstreamError(500, "oops")).toMatch(/HTTP 500/);
  });
});

function sse(events: object[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(new Blob([body]).stream(), { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("complete", () => {
  afterEach(() => vi.unstubAllGlobals());
  const tokens = { accessToken: "t", refreshToken: "r", expiresAt: Date.now() + 1e6, accountId: "acct" };

  it("collects streamed text from ChatGPT with the account header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sse([{ type: "response.output_text.delta", delta: "{\"a\"" }, { type: "response.output_text.delta", delta: ":1}" }, { type: "response.completed" }]));
    vi.stubGlobal("fetch", fetchMock);
    const deltas: string[] = [];
    const text = await complete({ provider: "codex", tokens, model: "m", system: "s", user: "u", effort: "low", onDelta: (d) => deltas.push(d) });
    expect(text).toBe('{"a":1}');
    expect(deltas).toHaveLength(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("chatgpt.com");
    expect(init.headers["chatgpt-account-id"]).toBe("acct");
    expect(JSON.parse(init.body).instructions).toBe("s");
  });

  it("retries without reasoning effort when Grok rejects it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"error":{"message":"reasoning effort not supported"}}', { status: 400 }))
      .mockResolvedValueOnce(sse([{ type: "response.output_text.delta", delta: "ok" }, { type: "response.completed" }]));
    vi.stubGlobal("fetch", fetchMock);
    const text = await complete({ provider: "grok", tokens, model: "grok-4.7", system: "s", user: "u", effort: "low" });
    expect(text).toBe("ok");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).reasoning).toBeUndefined();
  });

  it("surfaces stream errors and empty answers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse([{ type: "error", message: "boom" }])));
    await expect(complete({ provider: "grok", tokens, model: "g", system: "s", user: "u", effort: "low" })).rejects.toThrow("boom");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse([{ type: "response.completed" }])));
    await expect(complete({ provider: "grok", tokens, model: "g", system: "s", user: "u", effort: "low" })).rejects.toThrow(/stopped/);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })));
    await expect(complete({ provider: "codex", tokens, model: "g", system: "s", user: "u", effort: "low" })).rejects.toThrow(/expired/);
  });
});
