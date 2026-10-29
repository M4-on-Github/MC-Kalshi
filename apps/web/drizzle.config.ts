import { defineConfig } from "drizzle-kit";

// drizzle-kit does not read .env files; load the local one when present (absent in CI and on Vercel).
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local: rely on the process environment
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
