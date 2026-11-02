// Live smoke test for the AI canvas: real model, real fares, real route.
// Needs the dev servers running and a ChatGPT sign-in from the Codex CLI.
//
//   pnpm smoke            (reads ~/.codex/auth.json and CONTRAIL_SECRET from .env.local)
//
// It seals the Codex CLI token into the same encrypted cookie the app sets
// after sign-in, so the request goes through the real /api/ai/canvas path.
// Tokens are never printed.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { deriveKey, seal } from "../lib/ai/seal";

const BASE = process.env.CONTRAIL_URL ?? "http://localhost:3077";

function env(name: string): string {
  const line = readFileSync(".env.local", "utf8").split("\n").find((l) => l.startsWith(`${name}=`));
  if (!line) throw new Error(`${name} missing from .env.local`);
  return line.slice(name.length + 1).trim();
}

it("plans, searches and picks real flights", { timeout: 240_000 }, async () => {
  const auth = JSON.parse(readFileSync(`${homedir()}/.codex/auth.json`, "utf8"));
  const t = auth.tokens;
  const exp = JSON.parse(Buffer.from(t.access_token.split(".")[1], "base64url").toString()).exp * 1000;
  expect(exp).toBeGreaterThan(Date.now() + 5 * 60_000);

  const device = randomUUID();
  const key = deriveKey(env("CONTRAIL_SECRET"), "ai-session-cookies");
  const session = seal(key, JSON.stringify({ accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: exp, accountId: t.account_id, owner: device }), `codex:${device}`);
  const chunks = session.match(/.{1,3500}/g)!;
  const cookie = [`ct_device=${device}`, ...chunks.map((c, i) => `codex_s_${i}=${c}`)].join("; ");

  const res = await fetch(`${BASE}/api/ai/canvas`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ provider: "codex", prompt: "Bay Area to New York, leaving the first Friday of next month, back that Tuesday. Cheapest that isn't miserable." }),
  });
  expect(res.status).toBe(200);
  const events: Record<string, unknown>[] = [];
  const text = await res.text();
  for (const line of text.split("\n")) if (line.trim()) events.push(JSON.parse(line));

  const types = events.map((e) => e.type);
  const error = events.find((e) => e.type === "error");
  const plan = events.find((e) => e.type === "plan") as { plan: { searches: { label: string; from: string[]; to: string[]; depart: string }[] } } | undefined;
  const canvas = events.find((e) => e.type === "canvas") as { canvas: { headline: string; picks: { ref: string; title: string; tag: string }[] }; options: Record<string, { itinerary: { price: number } }> } | undefined;

  console.info("events:", types.join(" "));
  if (error) console.info("error:", error.error);
  console.info("plan:", plan?.plan.searches.map((s) => `${s.label} [${s.from.join("/")}→${s.to.join("/")} ${s.depart}]`).join(" | "));
  console.info("headline:", canvas?.canvas.headline);
  console.info("picks:", canvas?.canvas.picks.map((p) => `${p.tag}: ${p.title} $${canvas.options[p.ref]?.itinerary.price}`).join(" | "));

  expect(error).toBeUndefined();
  expect(plan?.plan.searches.length).toBeGreaterThan(0);
  expect(canvas?.canvas.picks.length).toBeGreaterThan(0);
  for (const p of canvas!.canvas.picks) expect(canvas!.options[p.ref]?.itinerary.price).toBeGreaterThan(0);
});
