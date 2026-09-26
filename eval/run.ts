import { retrieve } from "../backend/retrieval";
import type { Chunk } from "../backend/store";
import { policies, questions, unanswerable } from "./fixtures";
const chunks: Chunk[] = policies.map((p) => ({
  id: p.id,
  documentId: p.id,
  name: p.id + ".pdf",
  version: "synthetic-v1",
  page: 1,
  text: p.text,
  embedding: null,
  embeddingModel: null,
}));
let hits = 0,
  reciprocal = 0;
for (const [question, id] of questions) {
  const result = retrieve(chunks, question).slice(0, 3);
  const rank = result.findIndex((c) => c.id === id);
  if (rank >= 0) {
    hits++;
    reciprocal += 1 / (rank + 1);
  } else console.error("MISS", question);
}
const abstentions = unanswerable.filter(
  (q) => retrieve(chunks, q).length === 0,
).length;
const metrics = {
  dataset: "synthetic-regression-v1 (not real-world answer accuracy)",
  questions: questions.length,
  recallAt3: hits / questions.length,
  mrrAt3: reciprocal / questions.length,
  unanswerableQuestions: unanswerable.length,
  emptyRetrievalRate: abstentions / unanswerable.length,
};
console.log(JSON.stringify(metrics, null, 2));
if (
  metrics.recallAt3 < 0.95 ||
  metrics.mrrAt3 < 0.85 ||
  metrics.emptyRetrievalRate < 1
)
  process.exitCode = 1;
