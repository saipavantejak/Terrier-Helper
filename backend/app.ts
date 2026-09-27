import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import crypto from "node:crypto";
import { z } from "zod";
import type { Storage } from "./storage";
import { processOne } from "./ingest";
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
  store: Storage,
  provider: Provider,
  wake: () => void = () => {},
) {
  const app = express();
  const cloud = !!store.claimJob;
  const maxBytes = (cloud ? 3 : 10) * 1024 * 1024;
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
  app.get("/api/health", async (_req, res) => {
    await store.health();
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
  app.use("/api", async (req, res, next) => {
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
    if (
      store.consume &&
      !(await store.consume(
        "ip:" +
          crypto
            .createHash("sha256")
            .update(req.ip || "unknown")
            .digest("hex"),
        90,
        60000,
      ))
    )
      return res
        .status(429)
        .json({ error: "Too many requests. Please wait a minute." });
    const token = req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("terrier_owner="))
      ?.slice(14);
    if (await store.owner(token)) res.locals.owner = token;
    else if (req.path === "/workspace" && req.method === "GET") {
      res.locals.owner = await store.createOwner();
      res.cookie("terrier_owner", res.locals.owner, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        maxAge: 30 * 86400000,
        path: "/",
      });
    } else
      return res.status(401).json({
        error: "Workspace expired. Reload to create a new workspace.",
      });
    next();
  });
  app.use("/api", express.json({ limit: cloud ? "4.2mb" : "14mb" }));
  app.get("/api/workspace", async (_req, res) =>
    res.json({
      documents: await store.list(res.locals.owner),
      generationEnabled: provider.enabled,
      maxUploadMB: cloud ? 3 : 10,
      requestProcessing: cloud,
    }),
  );
  app.get("/api/documents", async (_req, res) =>
    res.json({ documents: await store.list(res.locals.owner) }),
  );
  app.post(
    "/api/documents",
    rateLimit({
      windowMs: 60000,
      limit: 8,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    async (req, res) => {
      if (
        store.consume &&
        !(await store.consume("upload:" + res.locals.owner, 8, 60000))
      )
        return res
          .status(429)
          .json({ error: "Too many uploads. Try again in a minute." });
      const data = uploadSchema.parse(req.body);
      const bytes = Buffer.from(data.base64, "base64");
      if (
        bytes.length > maxBytes ||
        bytes.subarray(0, 5).toString() !== "%PDF-"
      )
        return res
          .status(400)
          .json({ error: `Upload a valid PDF up to ${cloud ? 3 : 10} MB.` });
      try {
        const id = await store.add(res.locals.owner, data.name, bytes);
        wake();
        res
          .status(202)
          .json({ id, documents: await store.list(res.locals.owner) });
      } catch (e) {
        res
          .status(413)
          .json({ error: e instanceof Error ? e.message : "Upload failed." });
      }
    },
  );
  app.param("id", (_req, res, next, id) => {
    if (!z.string().uuid().safeParse(id).success) {
      res.status(400).json({ error: "Invalid document ID." });
      return;
    }
    next();
  });
  app.delete("/api/documents/:id", async (req, res) => {
    if (!(await store.remove(res.locals.owner, req.params.id)))
      return res.status(404).json({ error: "Document not found." });
    res.json({ documents: await store.list(res.locals.owner) });
  });
  app.post("/api/documents/:id/reindex", async (req, res) => {
    if (!(await store.file(res.locals.owner, req.params.id)))
      return res.status(404).json({ error: "Document not found." });
    await store.mark(req.params.id, "queued");
    wake();
    res.status(202).json({ ok: true });
  });
  app.get("/api/documents/:id/file", async (req, res) => {
    const file = await store.file(res.locals.owner, req.params.id);
    if (!file) return res.status(404).json({ error: "Document not found." });
    res
      .type("application/pdf")
      .setHeader(
        "Content-Disposition",
        "inline; filename*=UTF-8''" + encodeURIComponent(String(file.name)),
      );
    res.send(Buffer.from(file.bytes as Uint8Array));
  });
  app.post("/api/process", async (_req, res) => {
    if (
      store.consume &&
      !(await store.consume("process:" + res.locals.owner, 20, 60000))
    )
      return res.status(429).json({ error: "Too many processing requests." });
    const key = "index:" + res.locals.owner;
    const lease = store.acquire ? await store.acquire(key, 300000) : null;
    if (store.acquire && !lease)
      return res.json({ documents: await store.list(res.locals.owner) });
    try {
      await processOne(store, provider, res.locals.owner);
    } finally {
      if (lease && store.release) await store.release(key, lease);
    }
    res.json({ documents: await store.list(res.locals.owner) });
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
        return res.status(429).json({
          error: "A question is already processing. Please wait and retry.",
        });
      if (!provider.enabled)
        return res.status(503).json({
          error:
            "Answer generation is not configured. The operator must set GEMINI_API_KEY. Documents can still be uploaded and indexed.",
        });
      const docs = await store.list(owner);
      if (
        data.documentIds?.some(
          (id) => !docs.some((d) => d.id === id && d.status === "ready"),
        )
      )
        return res.status(409).json({
          error:
            "A selected document is unavailable or still indexing. Refresh the document list.",
        });
      let chunks = store.search
        ? []
        : await store.chunks(owner, data.documentIds);
      if (
        store.search ? !docs.some((d) => d.status === "ready") : !chunks.length
      )
        return res.status(409).json({
          error: "Upload a readable PDF and wait until indexing is complete.",
        });
      if (
        store.consume &&
        (!(await store.consume("chat:" + owner, 15, 60000)) ||
          !(await store.consume("chat:global", 100, 3600000)))
      )
        return res
          .status(429)
          .json({ error: "Question limit reached. Please try later." });
      const lease = store.acquire
        ? await store.acquire("chat:" + owner, 120000)
        : null;
      if (store.acquire && !lease)
        return res
          .status(429)
          .json({ error: "A question is already processing. Please wait." });
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
        if (
          store.search
            ? docs.some((d) => d.semantic && d.status === "ready")
            : chunks.some((c) => c.embeddingModel === provider.embeddingModel)
        ) {
          try {
            vector = (
              await provider.embed(
                [query],
                "RETRIEVAL_QUERY",
                controller.signal,
              )
            )[0];
            mode = "hybrid";
          } catch {
            send("progress", {
              message: "Semantic search unavailable; using keyword search.",
            });
          }
        }
        if (store.search)
          chunks = await store.search(
            owner,
            data.documentIds,
            query,
            vector,
            provider.embeddingModel,
          );
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
          (await store.list(owner))
            .filter((d) => d.status === "ready")
            .map((d) => d.id),
        );
        if (evidence.some((c) => !current.has(c.documentId)))
          throw new Error("Document changed during generation");
        send("answer", result);
        await store.record({
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
        await store.record({
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
        if (lease && store.release) await store.release("chat:" + owner, lease);
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
        return res.status(400).json({
          error:
            "Invalid request. Check file name, question length, and document IDs.",
        });
      const e = err as { status?: number; type?: string };
      res.status(e.status === 413 ? 413 : e.status === 400 ? 400 : 500).json({
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
