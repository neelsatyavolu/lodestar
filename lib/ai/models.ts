import "server-only";
import { bundledModels, loadModels, selectModels, type Model } from "@neelsatyavolu/shared-ai-auth";
import type { Provider } from "./providers";

// Add model IDs here only when Contrail should hide them. New IDs show by default.
const HIDDEN_MODELS: Record<Provider, string[]> = { codex: [], grok: [] };
const CACHE_MS = 5 * 60_000;
let cached = bundledModels;
let refreshAt = 0;

async function catalog(): Promise<Record<Provider, Model[]>> {
  if (Date.now() >= refreshAt) {
    cached = await loadModels({ fallback: cached });
    refreshAt = Date.now() + CACHE_MS;
  }
  return { codex: selectModels(cached, "codex", HIDDEN_MODELS.codex), grok: selectModels(cached, "grok", HIDDEN_MODELS.grok) };
}

export async function aiModels(): Promise<Record<Provider, { id: string; label: string }[]>> {
  const all = await catalog();
  return {
    codex: all.codex.map(({ id, label }) => ({ id, label })),
    grok: all.grok.map(({ id, label }) => ({ id, label })),
  };
}

/** The traveller's pick for the write-up; the catalog's fast tier for planning. */
export async function resolveModel(provider: Provider, requested: string | undefined, speed: "fast" | "main"): Promise<string> {
  const list = (await catalog())[provider];
  if (speed === "fast") {
    const fast = list.find((m) => m.tier === "fast");
    if (fast) return fast.id;
  }
  return list.find((m) => m.id === requested)?.id ?? list[0]?.id ?? (provider === "codex" ? "gpt-6-astra" : "grok-4.7");
}
