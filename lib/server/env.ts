import "server-only";
import { z } from "zod";

// Server configuration, checked once. Outside production the database falls
// back to an on-disk PGlite and the site address to localhost, so local
// development needs no services.

const schema = z.object({
  LODESTAR_SECRET: z.string().min(16, "LODESTAR_SECRET must be at least 16 characters"),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.url(),
  RESEND_API_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const production = process.env.NODE_ENV === "production";
  const parsed = schema.safeParse({
    LODESTAR_SECRET: process.env.LODESTAR_SECRET,
    DATABASE_URL: process.env.DATABASE_URL ?? (production ? undefined : "pglite://.data/lodestar"),
    APP_URL: process.env.APP_URL ?? (production ? undefined : "http://localhost:3000"),
    RESEND_API_KEY: process.env.RESEND_API_KEY || undefined,
  });
  if (!parsed.success) throw new Error(`Server misconfigured: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  cached = parsed.data;
  return cached;
}
