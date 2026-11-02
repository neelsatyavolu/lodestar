import "server-only";
import { createHash } from "node:crypto";

// Logo proxy. Tries each source in order, rejects known placeholder images,
// and falls back to a drawn monogram, so a logo URL never renders broken.

type Image = { body: ArrayBuffer; type: string; fallback?: boolean };

const TIMEOUT_MS = 4000;
const MAX_BYTES = 200_000;
// Bounded by bytes, not entries: 8 MB holds thousands of small logos.
const CACHE_BYTES = 8_000_000;
// A failed lookup may be a blip, so a fallback monogram is retried after this long.
const FALLBACK_TTL_MS = 10 * 60_000;
// Kiwi serves this same picture for every airline code it does not know.
const PLACEHOLDER_SHA1 = new Set(["850f013e69"]);
// Raster only. An upstream SVG could carry script and would be served from our origin.
const RASTER = /^image\/(png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon)\b/;
// null records a miss: the monogram is drawn per request so it always uses the right name.
const cache = new Map<string, { img: Image | null; at: number }>();
let cachedBytes = 0;

export function airlineSources(code: string): string[] {
  return [`https://www.gstatic.com/flights/airline_logos/70px/${code}.png`, `https://images.kiwi.com/airlines/64/${code}.png`];
}

export function siteSources(domain: string): string[] {
  return [`https://www.google.com/s2/favicons?domain=${domain}&sz=64`, `https://icons.duckduckgo.com/ip3/${domain}.ico`];
}

async function fetchImage(url: string): Promise<Image | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !RASTER.test(type)) return null;
    const body = await res.arrayBuffer();
    if (body.byteLength < 100 || body.byteLength > MAX_BYTES) return null;
    const sha = createHash("sha1").update(Buffer.from(body)).digest("hex").slice(0, 10);
    if (PLACEHOLDER_SHA1.has(sha)) return null;
    return { body, type };
  } catch {
    return null;
  }
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function initials(name: string): string {
  const clean = name.replace(/\.(com|net|org|co|io)$/i, "").trim();
  if (/^[A-Z0-9]{2,3}$/.test(clean)) return clean;
  const words = clean.split(/[\s\-_.]+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : clean.slice(0, 2);
  return letters.toUpperCase() || "?";
}

export function monogram(name: string): Image {
  const text = escapeXml(initials(name));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect x="0.5" y="0.5" width="63" height="63" rx="12" fill="#fcfdff"/><text x="32" y="38" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-size="${text.length > 2 ? 18 : 22}" font-weight="600" fill="#000000">${text}</text></svg>`;
  return { body: new TextEncoder().encode(svg).buffer as ArrayBuffer, type: "image/svg+xml", fallback: true };
}

function remember(key: string, img: Image | null): void {
  const size = (e?: { img: Image | null }) => e?.img?.body.byteLength ?? 0;
  cachedBytes -= size(cache.get(key));
  cache.delete(key);
  cache.set(key, { img, at: Date.now() });
  cachedBytes += size({ img });
  for (const [k, v] of cache) {
    if (cachedBytes <= CACHE_BYTES && cache.size <= 5000) break;
    cache.delete(k);
    cachedBytes -= size(v);
  }
}

export async function logo(key: string, sources: string[], fallbackName: string): Promise<Image> {
  const hit = cache.get(key);
  if (hit?.img) return hit.img;
  if (hit && Date.now() - hit.at < FALLBACK_TTL_MS) return monogram(fallbackName);
  let image: Image | null = null;
  for (const url of sources) {
    image = await fetchImage(url);
    if (image) break;
  }
  remember(key, image);
  return image ?? monogram(fallbackName);
}

export function imageResponse(img: Image): Response {
  return new Response(img.body, {
    headers: {
      "content-type": img.type,
      // Fallbacks are short-lived so a real logo replaces them once it loads.
      "cache-control": img.fallback ? "public, max-age=600" : "public, max-age=604800, stale-while-revalidate=86400",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "x-content-type-options": "nosniff",
    },
  });
}
