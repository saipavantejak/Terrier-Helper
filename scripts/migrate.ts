import "dotenv/config";
import pg from "pg";
import { readFile } from "node:fs/promises";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await db.connect();
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(73581000)");
  await db.query(
    await readFile(
      new URL("../migrations/001_cloud.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.query("COMMIT");
  console.log("Cloud schema ready.");
} catch {
  console.error(
    "Migration failed. Check database permissions, connectivity, and pgvector support.",
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
