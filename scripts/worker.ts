import "dotenv/config";
import { setTimeout as delay } from "node:timers/promises";
import { PostgresStore } from "../backend/postgres.js";
import { createProvider } from "../backend/provider.js";
import { processOne } from "../backend/ingest.js";
import {
  defaultInstitution,
  institutionOwner,
} from "../backend/institution.js";
if (!process.env.DATABASE_URL)
  throw new Error("DATABASE_URL is required for the shared worker");
const store = new PostgresStore(process.env.DATABASE_URL);
const provider = createProvider();
const owner = institutionOwner(defaultInstitution.id);
await store.ensureInstitution(owner);
let stopped = false;
process.on("SIGINT", () => {
  stopped = true;
});
process.on("SIGTERM", () => {
  stopped = true;
});
try {
  while (!stopped) {
    try {
      await processOne(store, provider, owner);
    } catch {
      console.error(JSON.stringify({ event: "worker_failed" }));
    }
    if (!stopped) await delay(3000);
  }
} finally {
  await store.close();
}
