import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const DEFAULT_POOL_MAX = 20;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;

const globalForDb = globalThis as unknown as {
  __aiIntelPgPool?: Pool | undefined;
};

let pool: Pool | undefined = globalForDb.__aiIntelPgPool;

function requireDatabaseUrl(connectionString: string | undefined) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  return connectionString;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getPool(connectionString = process.env.DATABASE_URL) {
  if (!pool) {
    pool = new Pool({
      connectionString: requireDatabaseUrl(connectionString),
      max: parsePositiveInt(process.env.DB_POOL_MAX, DEFAULT_POOL_MAX),
      idleTimeoutMillis: parsePositiveInt(
        process.env.DB_POOL_IDLE_TIMEOUT_MS,
        DEFAULT_IDLE_TIMEOUT_MS,
      ),
      connectionTimeoutMillis: parsePositiveInt(
        process.env.DB_POOL_CONNECTION_TIMEOUT_MS,
        DEFAULT_CONNECTION_TIMEOUT_MS,
      ),
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    });

    pool.on("error", (error) => {
      console.error("[db] Unexpected error on idle Postgres pool client:", error);
    });

    if (process.env.NODE_ENV !== "production") {
      globalForDb.__aiIntelPgPool = pool;
    }
  }

  return pool;
}

export function getDb(connectionString = process.env.DATABASE_URL) {
  return drizzle(getPool(connectionString), { schema });
}

export async function closePool() {
  if (!pool) {
    return;
  }

  await pool.end();
  pool = undefined;
  globalForDb.__aiIntelPgPool = undefined;
}

export type Database = ReturnType<typeof getDb>;

