import type { Chunk } from "./store";
const stop = new Set(
  "a an the is are was were be been being do does did i me my we our you your it its this that these those what which who when where how can could would should will shall please tell about of for to from in on at by and or with as".split(
    " ",
  ),
);
export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (w) => w.length > 1 && !stop.has(w),
  );
}
export function chunkPages(pages: string[], size = 220, overlap = 35) {
  if (size <= overlap || overlap < 0)
    throw new Error("Invalid chunk configuration");
  return pages.flatMap((text, page) => {
    const words = text.trim().split(/\s+/).filter(Boolean);
    const result: Array<{ page: number; text: string }> = [];
    for (let start = 0; start < words.length; start += size - overlap) {
      result.push({
        page: page + 1,
        text: words.slice(start, start + size).join(" "),
      });
      if (start + size >= words.length) break;
    }
    return result;
  });
}
export function cosine(a: number[], b: number[]) {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] ** 2;
    bb += b[i] ** 2;
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}
export function retrieve(
  chunks: Chunk[],
  question: string,
  queryVector: number[] | null = null,
  model: string | null = null,
  limit = 8,
) {
  const query = [...new Set(tokens(question))];
  const terms = chunks.map((c) => tokens(c.text));
  const avg = terms.reduce((sum, t) => sum + t.length, 0) / (terms.length || 1);
  const df = new Map<string, number>();
  terms.forEach((t) =>
    new Set(t).forEach((w) => df.set(w, (df.get(w) ?? 0) + 1)),
  );
  const keyword = chunks
    .map((c, i) => {
      const counts = new Map<string, number>();
      terms[i].forEach((w) => counts.set(w, (counts.get(w) ?? 0) + 1));
      const score = query.reduce((sum, w) => {
        const tf = counts.get(w) ?? 0;
        const idf = Math.log(
          1 +
            (chunks.length - (df.get(w) ?? 0) + 0.5) / ((df.get(w) ?? 0) + 0.5),
        );
        return (
          sum +
          (idf * tf * 2.2) /
            (tf + 1.2 * (0.25 + (0.75 * terms[i].length) / (avg || 1)))
        );
      }, 0);
      return { chunk: c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);
  const semantic = queryVector
    ? chunks
        .filter((c) => c.embedding && c.embeddingModel === model)
        .map((c) => ({ chunk: c, score: cosine(queryVector, c.embedding!) }))
        .filter((x) => x.score >= 0.5)
        .sort((a, b) => b.score - a.score)
        .slice(0, 30)
    : [];
  const fused = new Map<string, { chunk: Chunk; score: number }>();
  for (const ranking of [keyword, semantic])
    ranking.forEach((r, i) => {
      const current = fused.get(r.chunk.id) ?? { chunk: r.chunk, score: 0 };
      current.score += 1 / (60 + i + 1);
      fused.set(r.chunk.id, current);
    });
  // Bound context and suppress overlapping near-duplicates on the same page.
  const selected: Chunk[] = [];
  let characters = 0;
  for (const { chunk } of [...fused.values()].sort(
    (a, b) => b.score - a.score,
  )) {
    const set = new Set(tokens(chunk.text));
    if (
      selected.some((c) => {
        if (c.documentId !== chunk.documentId || c.page !== chunk.page)
          return false;
        const other = new Set(tokens(c.text));
        const common = [...set].filter((t) => other.has(t)).length;
        return common / Math.max(1, Math.min(set.size, other.size)) > 0.85;
      })
    )
      continue;
    if (characters + chunk.text.length > 14000) continue;
    selected.push(chunk);
    characters += chunk.text.length;
    if (selected.length >= limit) break;
  }
  return selected;
}
