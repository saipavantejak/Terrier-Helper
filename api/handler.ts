import express from "express";
import { PostgresStore } from "../backend/postgres";
import { createProvider } from "../backend/provider";
import { createApp } from "../backend/app";

const app = express();
if (!process.env.DATABASE_URL) {
  app.use((_req, res) =>
    res
      .status(503)
      .json({
        error:
          "Deployment setup incomplete: connect PostgreSQL and run the database migration.",
      }),
  );
} else {
  const store = new PostgresStore(process.env.DATABASE_URL);
  // Explicit project origin is recommended. Vercel terminates TLS before Express.
  app.set("trust proxy", 1);
  const api = createApp(store, createProvider());
  api.set("trust proxy", 1);
  app.get("/api/cron", async (req, res) => {
    if (
      !process.env.CRON_SECRET ||
      req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`
    )
      return res.status(401).json({ error: "Unauthorized" });
    await store.cleanup();
    res.json({ ok: true });
  });
  app.use(api);
}
export default app;
