import type express from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { Storage } from "./storage.js";
import { questionKey, readReceipt, validRule } from "./feedback.js";
import { retrievalQuestion } from "./conversation.js";
export function feedbackRoutes(
  app: express.Express,
  store: Storage,
  key: string,
  enabled: boolean,
  published: boolean,
  requireAdmin: express.RequestHandler,
) {
  app.post(
    "/api/feedback",
    rateLimit({
      windowMs: 60000,
      limit: 10,
      legacyHeaders: false,
      standardHeaders: "draft-8",
    }),
    async (req, res) => {
      if (!enabled)
        return res
          .status(503)
          .json({ error: "Feedback is not enabled for this deployment." });
      const data = z
        .object({
          token: z.string().max(150000),
          rating: z.enum(["helpful", "unhelpful"]),
          note: z.string().trim().max(1000).default(""),
          consent: z.literal(true),
        })
        .strict()
        .parse(req.body);
      if (
        store.consume &&
        !(await store.consume("feedback:" + res.locals.actor, 10, 60000))
      )
        return res
          .status(429)
          .json({ error: "Feedback limit reached. Try later." });
      const snapshot = readReceipt(
        key,
        data.token,
        res.locals.corpus,
        res.locals.actor,
      );
      if (!snapshot)
        return res
          .status(400)
          .json({
            error:
              "This feedback link is invalid or expired. Ask the question again.",
          });
      const created = await store.saveFeedback({
        id: snapshot.answer.requestId,
        corpus: res.locals.corpus,
        actor: res.locals.actor,
        questionKey: questionKey(
          retrievalQuestion(snapshot.question, snapshot.context),
        ),
        createdAt: new Date().toISOString(),
        status: "pending",
        rating: data.rating,
        note: data.note,
        snapshot,
      });
      res.status(created ? 201 : 200).json({ ok: true });
    },
  );
  app.get("/api/admin/feedback", requireAdmin, async (req, res) => {
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(100000)
      .parse(req.query.offset ?? 0);
    const records = await store.listFeedback(res.locals.corpus, offset);
    res.json({
      records: records.slice(0, 50),
      nextOffset: records.length > 50 ? offset + 50 : null,
    });
  });
  app.post(
    "/api/admin/feedback/:feedbackId/review",
    requireAdmin,
    async (req, res) => {
      const id = z.string().uuid().parse(req.params.feedbackId);
      const data = z
        .discriminatedUnion("status", [
          z.object({ status: z.literal("dismissed") }).strict(),
          z
            .object({
              status: z.literal("approved"),
              rule: z
                .object({
                  searchQuery: z.string().trim().min(3).max(300),
                  documentId: z.string().uuid(),
                  version: z.string().min(1).max(64),
                  page: z.number().int().min(1).max(300),
                  quote: z.string().trim().min(20).max(2000),
                })
                .strict(),
            })
            .strict(),
        ])
        .parse(req.body);
      const record = await store.getFeedback(res.locals.corpus, id);
      if (!record)
        return res.status(404).json({ error: "Feedback not found." });
      if (
        data.status === "approved" &&
        !(await validRule(store, res.locals.corpus, data.rule, published))
      )
        return res
          .status(409)
          .json({
            error:
              "Use an exact passage from the current published document and page.",
          });
      const updated = {
        ...record,
        status: data.status,
        rule: data.status === "approved" ? data.rule : undefined,
        reviewedBy: res.locals.actor,
        reviewedAt: new Date().toISOString(),
      };
      if (!(await store.reviewFeedback(updated)))
        return res
          .status(409)
          .json({ error: "Feedback changed. Refresh the review list." });
      await store.record({
        event: "feedback_reviewed",
        feedbackId: id,
        status: data.status,
        actor: res.locals.actor,
      });
      res.json({ ok: true });
    },
  );
  app.delete(
    "/api/admin/feedback/:feedbackId",
    requireAdmin,
    async (req, res) => {
      const id = z.string().uuid().parse(req.params.feedbackId);
      if (!(await store.deleteFeedback(res.locals.corpus, id)))
        return res.status(404).json({ error: "Feedback not found." });
      await store.record({
        event: "feedback_deleted",
        feedbackId: id,
        actor: res.locals.actor,
      });
      res.json({ ok: true });
    },
  );
}
