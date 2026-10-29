import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Server only: never import this module from a client component.
// Supabase's transaction pooler needs `prepare: false`; one connection per serverless instance.
function createClient(url: string) {
  const client = postgres(url, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 10 });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createClient>;

let cached: Db | undefined;

/** The Drizzle client, or `undefined` when `DATABASE_URL` is not configured. */
export function getDb(): Db | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return undefined;
  }
  cached ??= createClient(url);
  return cached;
}

/** Cheapest possible round-trip, used by `GET /api/health`. */
export async function pingDatabase(): Promise<void> {
  const db = getDb();
  if (!db) {
    throw new Error("DATABASE_URL is not configured");
  }
  await db.execute(sql`select 1`);
}
