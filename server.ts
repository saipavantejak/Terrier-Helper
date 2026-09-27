import "dotenv/config";
import express from "express";
import path from "node:path";
import { PostgresStore } from "./backend/postgres";
import { Store } from "./backend/store";
import { createProvider } from "./backend/provider";
import { ingestionWorker } from "./backend/ingest";
import { createApp } from "./backend/app";

const store = process.env.DATABASE_URL
  ? new PostgresStore(process.env.DATABASE_URL)
  : new Store(process.env.DATABASE_PATH || "data/terrier.sqlite");
await store.cleanup();
const provider = createProvider();
const worker = ingestionWorker(store, provider);
const app = createApp(store, provider, worker.wake);
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.resolve("dist")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.resolve("dist/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, "0.0.0.0", () => {
  console.log(
    JSON.stringify({
      event: "listening",
      port,
      generationEnabled: provider.enabled,
    }),
  );
  worker.wake();
});
const cleanup = setInterval(() => {
  Promise.resolve(store.cleanup()).catch(() =>
    console.error("Retention cleanup failed"),
  );
}, 3600000);
cleanup.unref();
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    worker.stop();
    clearInterval(cleanup);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10000).unref();
  });
