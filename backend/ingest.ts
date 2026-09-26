import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { chunkPages } from "./retrieval";
import type { Store } from "./store";
import type { Provider } from "./provider";
export async function extractPdf(bytes: Uint8Array) {
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 300)
      throw new Error(
        "PDF exceeds the 300-page limit. Split it into smaller documents.",
      );
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) =>
            "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
          )
          .join(""),
      );
      page.cleanup();
    }
    if (pages.every((p) => p.trim().length < 20))
      throw new Error(
        "No readable text found. Run OCR on scanned PDFs before uploading.",
      );
    const chunks = chunkPages(pages);
    if (chunks.length > 1500)
      throw new Error("Document text exceeds indexing limits. Split the PDF.");
    return { pages, chunks };
  } finally {
    await task.destroy();
  }
}
export function ingestionWorker(store: Store, provider: Provider) {
  let running = false,
    stopped = false;
  async function drain() {
    if (running || stopped) return;
    running = true;
    try {
      let job;
      while (!stopped && (job = store.nextJob())) {
        const id = String(job.id);
        store.mark(id, "processing");
        try {
          const { pages, chunks } = await extractPdf(job.bytes as Uint8Array);
          let vectors: number[][] | null = null;
          let warning = pages.some((p) => p.trim().length < 20)
            ? "Some pages contain little or no text. Scanned content may require OCR."
            : null;
          if (provider.enabled) {
            try {
              vectors = await provider.embed(
                chunks.map((c) => c.text),
                "RETRIEVAL_DOCUMENT",
              );
            } catch {
              warning = [
                warning,
                "Semantic indexing unavailable. Keyword search is active; retry indexing later.",
              ]
                .filter(Boolean)
                .join(" ");
            }
          }
          store.saveChunks(
            id,
            pages.length,
            chunks,
            vectors,
            vectors ? provider.embeddingModel : null,
            warning,
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : "Could not read PDF";
          store.mark(
            id,
            "failed",
            message.includes("OCR") ||
              message.includes("limit") ||
              message.includes("Split")
              ? message
              : "Could not read this PDF. It may be encrypted, damaged, or unsupported.",
          );
        }
      }
    } finally {
      running = false;
    }
  }
  return {
    wake: () => {
      void drain();
    },
    stop: () => {
      stopped = true;
    },
    idle: () => !running,
  };
}
