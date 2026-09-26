import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import crypto from "node:crypto";
import { z } from "zod";
import type { Store } from "./store";
import { retrieve } from "./retrieval";
import { validateCitations, type Provider } from "./provider";
import type { Answer } from "../types";

const uploadSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(/\.pdf$/i),
    base64: z
      .string()
      .min(8)
      .max(14_000_000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();
const querySchema = z
  .object({
    question: z.string().trim().min(3).max(2000),
    documentIds: z.array(z.string().uuid()).max(30).optional(),
    previousQuestion: z.string().max(2000).optional(),
  })
  .strict();
export function createApp(
  store: Store,
  provider: Provider,
  wake: () => void = () => {},
) {
  const app = express();
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY)
    app.set("trust proxy", Number(process.env.TRUST_PROXY));
  app.use(
    helmet({
      contentSecurityPolicy:
        process.env.NODE_ENV === "production"
          ? {
              directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", "data:"],
                connectSrc: ["'self'"],
                objectSrc: ["'none'"],
                frameAncestors: ["'none'"],
                upgradeInsecureRequests: null,
              },
            }
          : false,
    }),
  );
  app.get("/api/health", (_req, res) => {
    store.db.prepare("SELECT 1").get();
    res.json({ status: "ok" });
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 90,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.locals.requestId = crypto.randomUUID();
    res.setHeader("X-Request-Id", res.locals.requestId);
    if (!["GET", "HEAD"].includes(req.method)) {
      const origin = req.headers.origin;
      const expected =
        process.env.APP_ORIGIN || `${req.protocol}://${req.get("host")}`;
      if (
        req.headers["sec-fetch-site"] === "cross-site" ||
        (origin && origin !== expected)
      )
        return res.status(403).json({ error: "Cross-site request rejected." });
      if (
        !req.get("content-type")?.toLowerCase().startsWith("application/json")
      )
        return res.status(415).json({ error: "Use application/json." });
    }
    const token = req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("terrier_owner="))
      ?.slice(14);
    if (store.owner(token)) res.locals.owner = token;
    else if (req.path === "/workspace" && req.method === "GET") {
      res.locals.owner = store.createOwner();
      res.cookie("terrier_owner", res.locals.owner, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        maxAge: 30 * 86400000,
        path: "/",
      });
    } else
      return res
        .status(401)
        .json({
          error: "Workspace expired. Reload to create a new workspace.",
        });
    next();
  });
  app.use("/api", express.json({ limit: "14mb" }));
  app.get("/api/workspace", (_req, res) =>
    res.json({
      documents: store.list(res.locals.owner),
      generationEnabled: provider.enabled,
    }),
  );
  app.get("/api/documents", (_req, res) =>
    res.json({ documents: store.list(res.locals.owner) }),
  );
  app.post(
    "/api/documents",
    rateLimit({
      windowMs: 60000,
      limit: 8,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    (req, res) => {
      const data = uploadSchema.parse(req.body);
      const bytes = Buffer.from(data.base64, "base64");
      if (
        bytes.length > 10 * 1024 * 1024 ||
        bytes.subarray(0, 5).toString() !== "%PDF-"
      )
        return res
          .status(400)
          .json({ error: "Upload a valid PDF up to 10 MB." });
      try {
        const id = store.add(res.locals.owner, data.name, bytes);
        wake();
        res.status(202).json({ id, documents: store.list(res.locals.owner) });
      } catch (e) {
        res
          .status(413)
          .json({ error: e instanceof Error ? e.message : "Upload failed." });
      }
    },
  );
  app.delete("/api/documents/:id", (req, res) => {
    if (!store.remove(res.locals.owner, req.params.id))
      return res.status(404).json({ error: "Document not found." });
    res.json({ documents: store.list(res.locals.owner) });
  });
  app.post("/api/documents/:id/reindex", (req, res) => {
    if (!store.file(res.locals.owner, req.params.id))
      return res.status(404).json({ error: "Document not found." });
    store.mark(req.params.id, "queued");
    wake();
    res.status(202).json({ ok: true });
  });
  app.get("/api/documents/:id/file", (req, res) => {
    const file = store.file(res.locals.owner, req.params.id);
    if (!file) return res.status(404).json({ error: "Document not found." });
    res
      .type("application/pdf")
      .setHeader(
        "Content-Disposition",
        "inline; filename*=UTF-8''" + encodeURIComponent(String(file.name)),
      );
    res.send(Buffer.from(file.bytes as Uint8Array));
  });
  const activeOwners = new Set<string>();
  app.post(
    "/api/chat",
    rateLimit({
      windowMs: 60000,
      limit: 15,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    async (req, res) => {
      const data = querySchema.parse(req.body),
        owner = res.locals.owner as string;
      if (activeOwners.has(owner) || activeOwners.size >= 8)
        return res
          .status(429)
          .json({
            error: "A question is already processing. Please wait and retry.",
          });
      if (!provider.enabled)
        return res
          .status(503)
          .json({
            error:
              "Answer generation is not configured. The operator must set GEMINI_API_KEY. Documents can still be uploaded and indexed.",
          });
      const docs = store.list(owner);
      if (
        data.documentIds?.some(
          (id) => !docs.some((d) => d.id === id && d.status === "ready"),
        )
      )
        return res
          .status(409)
          .json({
            error:
              "A selected document is unavailable or still indexing. Refresh the document list.",
          });
      const chunks = store.chunks(owner, data.documentIds);
      if (!chunks.length)
        return res
          .status(409)
          .json({
            error: "Upload a readable PDF and wait until indexing is complete.",
          });
      activeOwners.add(owner);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 90000);
      res.on("close", () => {
        if (!res.writableEnded) controller.abort();
      });
      const started = Date.now(),
        requestId = res.locals.requestId;
      let usage = 0,
        mode: Answer["retrievalMode"] = "keyword";
      const send = (event: string, value: unknown) => {
        if (!res.destroyed)
          res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
      };
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      const heartbeat = setInterval(() => {
        if (!res.destroyed) res.write(": keepalive\n\n");
      }, 15000);
      try {
        send("progress", { message: "Finding relevant passages…" });
        // Only previous user question aids retrieval; past AI answers are never evidence.
        const query =
          data.previousQuestion &&
          /\b(it|that|those|they|this|also|what about)\b/i.test(data.question)
            ? `${data.previousQuestion}\n${data.question}`
            : data.question;
        let vector: number[] | null = null;
        if (chunks.some((c) => c.embeddingModel === provider.embeddingModel)) {
          try {
            vector = (await provider.embed([query], "RETRIEVAL_QUERY"))[0];
            mode = "hybrid";
          } catch {
            send("progress", {
              message: "Semantic search unavailable; using keyword search.",
            });
          }
        }
        const evidence = retrieve(
          chunks,
          query,
          vector,
          provider.embeddingModel,
        );
        const empty: Answer = {
          status: "insufficient_evidence",
          statements: [],
          citations: [],
          retrievalMode: mode,
          requestId,
        };
        let result = empty;
        if (evidence.length) {
          send("progress", {
            message: "Drafting an answer from the selected evidence…",
          });
          const generated = await provider.answer(
            query,
            evidence,
            controller.signal,
          );
          usage += generated.tokens;
          const grounded = validateCitations(generated.output, evidence);
          if (grounded.statements.length) {
            send("progress", {
              message: "Checking claims and source quotations…",
            });
            const verification = await provider.verify(
              generated.output.claims,
              evidence,
              controller.signal,
            );
            usage += verification.tokens;
            // Fail closed if any claim is unsupported; don't present a misleading partial answer.
            if (verification.supported.every(Boolean))
              result = { ...empty, ...grounded, status: "answered" };
          }
        }
        // Re-check document ownership/existence after slow provider calls.
        const current = new Set(
          store
            .list(owner)
            .filter((d) => d.status === "ready")
            .map((d) => d.id),
        );
        if (evidence.some((c) => !current.has(c.documentId)))
          throw new Error("Document changed during generation");
        send("answer", result);
        store.record({
          requestId,
          event: "answer",
          status: result.status,
          latencyMs: Date.now() - started,
          totalTokens: usage,
          retrievalMode: mode,
          candidates: evidence.length,
        });
        send("done", {});
      } catch {
        send("error", {
          error: controller.signal.aborted
            ? "The request timed out or was cancelled. Please retry."
            : "Could not produce a verified answer. Please retry or inspect your documents.",
          requestId,
        });
        store.record({
          requestId,
          event: "answer_error",
          latencyMs: Date.now() - started,
          totalTokens: usage,
        });
      } finally {
        clearTimeout(timer);
        clearInterval(heartbeat);
        activeOwners.delete(owner);
        res.end();
      }
    },
  );
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "API route not found." }),
  );
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err instanceof z.ZodError)
        return res
          .status(400)
          .json({
            error:
              "Invalid request. Check file name, question length, and document IDs.",
          });
      const e = err as { status?: number; type?: string };
      res
        .status(e.status === 413 ? 413 : e.status === 400 ? 400 : 500)
        .json({
          error:
            e.status === 413
              ? "Request is too large."
              : e.status === 400
                ? "Invalid JSON request."
                : "Request failed.",
        });
    },
  );
  return app;
}
