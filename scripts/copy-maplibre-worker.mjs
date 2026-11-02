// MapLibre runs its tile work in a Web Worker that bundlers can't locate, so
// serve the published worker file from public/ (see components/journeys/trip-map.tsx).
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("maplibre-gl/package.json"));
const out = join(import.meta.dirname, "..", "public", "maplibre-gl-worker.mjs");
mkdirSync(dirname(out), { recursive: true });
copyFileSync(join(pkgDir, "dist", "maplibre-gl-worker.mjs"), out);
