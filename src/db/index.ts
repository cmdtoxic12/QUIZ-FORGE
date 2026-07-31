import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.warn(
    "[QuizForge] DATABASE_URL is not set. API routes and pages that query the database will fail until it is configured.",
  );
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    // Fallback keeps the module importable during local tooling; real requests still need a valid URL.
    connectionString: databaseUrl ?? "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
