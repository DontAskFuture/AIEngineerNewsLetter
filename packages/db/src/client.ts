import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

let pool: Pool | undefined;

function requireDatabaseUrl(connectionString: string | undefined) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  return connectionString;
}

export function getPool(connectionString = process.env.DATABASE_URL) {
  if (!pool) {
    pool = new Pool({
      connectionString: requireDatabaseUrl(connectionString),
    });
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
}

export type Database = ReturnType<typeof getDb>;

