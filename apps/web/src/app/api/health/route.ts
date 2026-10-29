import { pingDatabase } from "@/db";
import { buildHealth } from "@/lib/health";

// Evaluated per request so the database status is live, not baked in at build time.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const { status, body } = await buildHealth({
    dbCheck: process.env.DATABASE_URL ? pingDatabase : undefined,
    commit: process.env.VERCEL_GIT_COMMIT_SHA,
  });
  return Response.json(body, { status });
}
