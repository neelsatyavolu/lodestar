import { defineConfig } from "vitest/config";

// Live checks against running dev servers. Not part of `pnpm test`.
export default defineConfig({ test: { include: ["test/**/*.smoke.ts"] } });
