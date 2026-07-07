// Applies the app schema (server/db/schema.sql) to the database. Run AFTER
// better-auth has created its tables (bun run auth:generate then migrate).
import { sql } from "../src/db.ts";

const schema = await Bun.file(
  new URL("../db/schema.sql", import.meta.url),
).text();

await sql.unsafe(schema);
console.log("Applied server/db/schema.sql");
await sql.end();
