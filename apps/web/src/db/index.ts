import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Server only: never import this module from a client component.
// Supabase's transaction pooler needs `prepare: false`; one connection per serverless instance.
// `connect_timeout` is kept under the health route's 2 s budget plus slack so a stuck connect
// cannot hold the single connection for long.
function createClient(url: string) {
  return drizzle(postgres(url, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 5 }), {
    schema,
  });
}

export type Db = ReturnType<typeof createClient>;

// `next dev` re-evaluates this module on every hot reload; caching on globalThis stops each
// reload from opening another pooled connection.
const store = globalThis as typeof globalThis & { __mcKalshiDb?: Db };

/** The Drizzle client, or `undefined` when `DATABASE_URL` is not configured. */
export function getDb(): Db | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return undefined;
  }
  store.__mcKalshiDb ??= createClient(url);
  return store.__mcKalshiDb;
}

/** Cheapest possible round-trip, used by `GET /api/health`. */
export async function pingDatabase(): Promise<void> {
  const db = getDb();
  if (!db) {
    throw new Error("DATABASE_URL is not configured");
  }
  await db.execute(sql`select 1`);
}
