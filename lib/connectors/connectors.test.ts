import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { DeliverySchema, hashCode, manifest, newPairCode, normalizeCode, PairSchema, signDelivery, verifyDelivery } from "./flint";
import { fetchReceived, tokenFromRecipients, verifySvix } from "./resend";

const secret = Buffer.alloc(32, 7).toString("base64url");
const now = 1_800_000_000_000;
const ts = String(now / 1000);

describe("Flint connector", () => {
  it("publishes a manifest whose endpoints live on the app's own host", () => {
    const m = manifest("https://lodestar.xanom.co/");
    expect(m.flintConnector).toBe(1);
    for (const url of [m.pairPage, m.pairEndpoint, m.deliverEndpoint, m.revokeEndpoint]) expect(new URL(url).host).toBe("lodestar.xanom.co");
    expect(m.match.any.every((c) => c.field === "from" && c.op === "ends_with" && c.value.startsWith("@") && c.value.length > 4)).toBe(true);
    expect(m.match.schemaTypes).toContain("FlightReservation");
    expect(m.fields).not.toContain("attachments");
  });

  it("makes readable pairing codes and hashes what was typed the same way", () => {
    const code = newPairCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    const pepper = Buffer.alloc(32, 1);
    expect(hashCode(pepper, `${code.slice(0, 4).toLowerCase()}-${code.slice(4)}`)).toBe(hashCode(pepper, code));
    expect(normalizeCode(" ab-cd ef12 ")).toBe("ABCDEF12");
  });

  it("checks a delivery's signature, freshness and body", () => {
    const body = '{"messageId":"<a>"}';
    const signature = signDelivery(secret, Number(ts), body);
    expect(signature).toBe(`v1=${createHmac("sha256", Buffer.alloc(32, 7)).update(`${ts}.${body}`).digest("hex")}`);
    expect(verifyDelivery({ secret, timestamp: ts, signature, body, now })).toBe(true);
    expect(verifyDelivery({ secret, timestamp: ts, signature, body: `${body} `, now })).toBe(false);
    expect(verifyDelivery({ secret, timestamp: ts, signature, body, now: now + 6 * 60_000 })).toBe(false);
    expect(verifyDelivery({ secret: Buffer.alloc(32, 8).toString("base64url"), timestamp: ts, signature, body, now })).toBe(false);
    expect(verifyDelivery({ secret, timestamp: null, signature, body, now })).toBe(false);
    expect(verifyDelivery({ secret, timestamp: ts, signature: "v1=00", body, now })).toBe(false);
  });

  it("validates pairing and delivery payloads", () => {
    expect(PairSchema.safeParse({ code: "ABCD-EFGH", connectionId: "6f1c9d4e-2b1a-4c3d-9e8f-0a1b2c3d4e5f", secret }).success).toBe(true);
    expect(PairSchema.safeParse({ code: "ABCD-EFGH", connectionId: "6f1c9d4e-2b1a-4c3d-9e8f-0a1b2c3d4e5f", secret: "short" }).success).toBe(false);
    expect(DeliverySchema.parse({ messageId: "<a>", from: { name: "United", address: "x@united.com" }, to: [{ name: "", address: "me@x.co" }], date: 1_800_000_000_000, text: null, subject: "Trip" })).toMatchObject({ from: "United <x@united.com>", to: ["me@x.co"] });
  });
});

describe("Resend inbound", () => {
  const whsec = `whsec_${Buffer.alloc(24, 3).toString("base64")}`;
  const svix = (body: string, t = ts) => `v1,${createHmac("sha256", Buffer.alloc(24, 3)).update(`msg_1.${t}.${body}`).digest("base64")}`;

  it("verifies Svix signatures, including one of several", () => {
    const body = '{"type":"email.received"}';
    expect(verifySvix({ secret: whsec, id: "msg_1", timestamp: ts, signature: `v1,bogus ${svix(body)}`, body, now })).toBe(true);
    expect(verifySvix({ secret: whsec, id: "msg_2", timestamp: ts, signature: svix(body), body, now })).toBe(false);
    expect(verifySvix({ secret: whsec, id: "msg_1", timestamp: ts, signature: svix(body), body, now: now + 10 * 60_000 })).toBe(false);
    expect(verifySvix({ secret: whsec, id: null, timestamp: ts, signature: svix(body), body, now })).toBe(false);
  });

  it("finds the account token in the recipient list", () => {
    const token = "a".repeat(24);
    expect(tokenFromRecipients(["someone@else.com", `Trips <${token.toUpperCase()}+united@In.Lodestar.co>`], "in.lodestar.co")).toBe(token);
    expect(tokenFromRecipients([`${token}@other.co`], "in.lodestar.co")).toBeNull();
    expect(tokenFromRecipients(["short@in.lodestar.co"], "in.lodestar.co")).toBeNull();
  });

  it("fetches the received email with inline images kept as references", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: "e1", from: "a@b.co", subject: "Hi", html: "<p>x</p>", text: null, message_id: "<m>" }))) as unknown as typeof fetch;
    expect(await fetchReceived("e1", "re_key", fetcher)).toMatchObject({ id: "e1", html: "<p>x</p>", message_id: "<m>" });
    const [url, init] = (fetcher as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails/receiving/e1?html_format=cid");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_key");
    await expect(fetchReceived("e1", "k", vi.fn(async () => new Response("", { status: 404 })) as unknown as typeof fetch)).rejects.toThrow("404");
  });
});
