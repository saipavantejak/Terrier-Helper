import crypto from "node:crypto";
import type { Answer } from "../types.js";
import type { Storage } from "./storage.js";
export interface FeedbackSnapshot {
  question: string;
  context?: string;
  answer: Answer;
}
export interface LearningRule {
  searchQuery: string;
  documentId: string;
  version: string;
  page: number;
  quote: string;
}
export interface FeedbackRecord {
  id: string;
  corpus: string;
  actor: string;
  questionKey: string;
  createdAt: string;
  status: "pending" | "approved" | "dismissed";
  rating: "helpful" | "unhelpful";
  note: string;
  snapshot: FeedbackSnapshot;
  rule?: LearningRule;
  reviewedBy?: string;
  reviewedAt?: string;
}
export function questionKey(question: string) {
  return crypto
    .createHash("sha256")
    .update(
      question
        .normalize("NFKC")
        .toLowerCase()
        .trim()
        .replace(/[!?.,]+$/g, "")
        .replace(/\s+/g, " "),
    )
    .digest("hex");
}
/** Receipts bind voluntary submissions to a real, untampered server answer and its session. */
export function feedbackReceipt(
  key: string,
  corpus: string,
  actor: string,
  snapshot: FeedbackSnapshot,
) {
  const payload = Buffer.from(
    JSON.stringify({ corpus, actor, snapshot, expires: Date.now() + 86400000 }),
  ).toString("base64url");
  return (
    payload +
    "." +
    crypto
      .createHmac("sha256", key)
      .update("feedback-v1:" + payload)
      .digest("base64url")
  );
}
export function readReceipt(
  key: string,
  token: string,
  corpus: string,
  actor: string,
): FeedbackSnapshot | null {
  try {
    const [payload, signature, extra] = token.split(".");
    if (extra || !signature) return null;
    const expected = crypto
      .createHmac("sha256", key)
      .update("feedback-v1:" + payload)
      .digest();
    const actual = Buffer.from(signature, "base64url");
    if (
      actual.length !== expected.length ||
      !crypto.timingSafeEqual(actual, expected)
    )
      return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (
      data.corpus !== corpus ||
      data.actor !== actor ||
      data.expires < Date.now()
    )
      return null;
    return data.snapshot;
  } catch {
    return null;
  }
}
export async function validRule(
  store: Storage,
  corpus: string,
  rule: LearningRule,
  published: boolean,
) {
  return store.hasPassage(corpus, rule, published);
}
/** Feedback is never evidence. A reviewed hint only augments retrieval for the exact contextual question. */
export async function learnedQuery(
  store: Storage,
  corpus: string,
  question: string,
  published: boolean,
) {
  const records = await store.learningRules(corpus, questionKey(question));
  for (const record of records) {
    if (record.rule && (await validRule(store, corpus, record.rule, published)))
      return question + "\nDocument search terms: " + record.rule.searchQuery;
  }
  return question;
}
