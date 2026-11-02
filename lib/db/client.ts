import "server-only";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "../server/env";
import { migrate } from "./schema";

export type Row = Record<string, unknown>;
export type Queryable = { query<T = Row>(sql: string, params?: unknown[]): Promise<T[]> };
export type Db = Queryable & { transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> };

const PGLITE_SCHEME = "pglite://";

/** Postgres in-process. Used by tests and local development. */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir) mkdirSync(dirname(dataDir), { recursive: true });
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  return {
    query: async <T>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows,
    transaction: <T>(fn: (tx: Queryable) => Promise<T>) =>
      pg.transaction((tx) => fn({ query: async <R>(sql: string, params: unknown[] = []) => (await tx.query<R>(sql, params)).rows })) as Promise<T>,
  };
}

/** `pg` warns that `sslmode=require` will weaken; naming `verify-full` keeps full certificate checks. */
export function explicitSslMode(url: string): string {
  return url.replace(/([?&]sslmode=)(?:require|prefer|verify-ca)(?=&|$)/, "$1verify-full");
}

/** A real Postgres server (Neon in production). */
export async function createPostgresDb(url: string): Promise<Db> {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: explicitSslMode(url), max: 5, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 });
  // A hosted database drops idle connections; without a listener that crashes the instance.
  pool.on("error", (error) => console.error("[lodestar] idle database connection lost:", error.message));
  const { attachDatabasePool } = await import("@vercel/functions");
  attachDatabasePool(pool);
  return {
    query: async <T>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[],
    transaction: async <T>(fn: (tx: Queryable) => Promise<T>) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({ query: async <R>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as R[] });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

async function open(url: string): Promise<Db> {
  const db = url.startsWith(PGLITE_SCHEME)
    ? await createPgliteDb(url === `${PGLITE_SCHEME}memory` ? undefined : url.slice(PGLITE_SCHEME.length))
    : await createPostgresDb(url);
  await migrate(db);
  return db;
}

// Kept on globalThis so dev-server reloads reuse one connection.
const holder = globalThis as typeof globalThis & { __lodestarDb?: Promise<Db> };

/** The process-wide database, migrated on first use. */
export function getDb(): Promise<Db> {
  holder.__lodestarDb ??= open(env().DATABASE_URL).catch((error) => {
    holder.__lodestarDb = undefined;
    throw error;
  });
  return holder.__lodestarDb;
}
