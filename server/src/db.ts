import postgres from "postgres";
import pg from "pg";
import { env } from "./env.ts";

// postgres.js drives all app queries and (in Phase 3) LISTEN/NOTIFY for SSE.
export const sql = postgres(env.databaseUrl, {
  max: 10,
  onnotice: () => {},
});

// A node-postgres Pool is handed to better-auth, which speaks pg natively.
export const pgPool = new pg.Pool({ connectionString: env.databaseUrl });

export async function assertDbReady() {
  await sql`select 1`;
}
