import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Store, type Chunk } from "../backend/store";
import { chunkPages, retrieve } from "../backend/retrieval";
import { validateCitations, type Provider } from "../backend/provider";
import { extractPdf, ingestionWorker } from "../backend/ingest";
import ChatWindow from "../ChatWindow";
export function chunk(
  id: string,
  text: string,
  page = 1,
  documentId = "doc",
): Chunk {
  return {
    id,
    text,
    page,
    documentId,
    name: "Handbook.pdf",
    version: "v1",
    embedding: null,
    embeddingModel: null,
  };
}
export async function pdfBytes(texts: string[]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  texts.forEach((text) => {
    pdf
      .addPage()
      .drawText(text, { x: 40, y: 700, font, size: 12, maxWidth: 500 });
  });
  return Buffer.from(await pdf.save());
}
test("chunking preserves page numbers and never crosses pages", () => {
  const chunks = chunkPages(
    ["alpha beta gamma delta epsilon zeta", "second page policy"],
    4,
    1,
  );
  assert.deepEqual(
    chunks.map((c) => c.page),
    [1, 1, 2],
  );
  assert.equal(chunks[1].text, "delta epsilon zeta");
  assert.throws(() => chunkPages(["x"], 2, 2));
});
test("retrieval ranks exact policy terms and returns no evidence for unrelated queries", () => {
  const chunks = [
    chunk("a", "Tuition payment deadline is September 15."),
    chunk("b", "The library loans books for fourteen days."),
  ];
  assert.equal(retrieve(chunks, "What is the tuition deadline?")[0].id, "a");
  assert.equal(retrieve(chunks, "dinosaur spacecraft").length, 0);
});
test("semantic retrieval finds paraphrases and ignores incompatible embedding models", () => {
  const source = {
    ...chunk("a", "Students may borrow books for two weeks."),
    embedding: [1, 0],
    embeddingModel: "model-a",
  };
  assert.equal(
    retrieve([source], "loan duration", [1, 0], "model-a")[0].id,
    "a",
  );
  assert.equal(
    retrieve([source], "loan duration", [1, 0], "model-b").length,
    0,
  );
});
test("citations require an existing retrieved source and an exact quote", () => {
  const source = chunk("a", "Tuition is due on September 15.");
  const output = {
    status: "answered" as const,
    claims: [
      {
        text: "Tuition is due September 15.",
        evidence: [{ sourceId: "a", quote: "Tuition is due on September 15." }],
      },
    ],
  };
  assert.equal(validateCitations(output, [source]).citations[0].page, 1);
  assert.throws(() =>
    validateCitations(
      {
        ...output,
        claims: [
          {
            ...output.claims[0],
            evidence: [{ sourceId: "b", quote: source.text }],
          },
        ],
      },
      [source],
    ),
  );
  assert.throws(() =>
    validateCitations(
      {
        ...output,
        claims: [
          {
            ...output.claims[0],
            evidence: [
              { sourceId: "a", quote: "Tuition is due on October 15." },
            ],
          },
        ],
      },
      [source],
    ),
  );
});
test("store persists ownership, deduplicates files, and deletes file and chunks together", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "terrier-test-"));
  const file = path.join(dir, "store.sqlite");
  let store = new Store(file);
  try {
    const owner = store.createOwner(),
      other = store.createOwner();
    const id = store.add(owner, "policy.pdf", Buffer.from("%PDF-test"));
    assert.equal(store.add(owner, "copy.pdf", Buffer.from("%PDF-test")), id);
    store.saveChunks(
      id,
      1,
      [{ page: 1, text: "Policy text" }],
      null,
      null,
      null,
    );
    store.close();
    store = new Store(file);
    assert.equal(store.owner(owner), true);
    assert.equal(store.list(owner).length, 1);
    assert.equal(store.list(other).length, 0);
    assert.equal(store.file(other, id), undefined);
    assert.equal(store.chunks(other).length, 0);
    assert.equal(store.remove(other, id), false);
    assert.equal(store.remove(owner, id), true);
    assert.equal(store.chunks(owner).length, 0);
    assert.equal(store.file(owner, id), undefined);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("expired owners are rejected and cleanup removes their documents", () => {
  const store = new Store(":memory:");
  const owner = store.createOwner();
  store.add(owner, "policy.pdf", Buffer.from("%PDF-test"));
  store.db.prepare("UPDATE owners SET expires=0 WHERE id=?").run(owner);
  assert.equal(store.owner(owner), false);
  store.cleanup();
  assert.equal(store.list(owner).length, 0);
  store.close();
});
test("PDF extraction preserves source pages; empty scans fail explicitly", async () => {
  const result = await extractPdf(
    await pdfBytes([
      "The tuition payment deadline is September 15.",
      "Library borrowing is limited to fourteen days.",
    ]),
  );
  assert.equal(result.pages.length, 2);
  assert.match(result.chunks.find((c) => c.page === 2)!.text, /fourteen/);
  const blank = await PDFDocument.create();
  blank.addPage();
  await assert.rejects(() => extractPdf(new Uint8Array(Buffer.from([]))), /./);
  await assert.rejects(extractPdf(await blank.save()), /OCR/);
});
test("rendering never interprets user or model content as HTML", () => {
  const markup = renderToStaticMarkup(
    createElement(ChatWindow, {
      messages: [
        {
          id: "x",
          role: "user",
          content: '<strong onmouseover="alert(1)">test</strong>',
        },
      ],
      busy: false,
      ready: true,
      progress: "",
      onSend: () => {},
      onCancel: () => {},
    }),
  );
  assert.ok(!markup.includes("<strong onmouseover"));
  assert.ok(markup.includes("&lt;strong"));
});
test("background ingestion survives an embedding outage with explicit keyword fallback", async () => {
  const store = new Store(":memory:");
  const owner = store.createOwner();
  const id = store.add(
    owner,
    "policy.pdf",
    await pdfBytes(["The tuition payment deadline is September 15."]),
  );
  const provider = {
    enabled: true,
    embeddingModel: "test",
    embed: async () => {
      throw new Error("outage");
    },
  } as unknown as Provider;
  const worker = ingestionWorker(store, provider);
  worker.wake();
  for (let i = 0; i < 100 && !worker.idle(); i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(store.list(owner)[0].status, "ready");
  assert.equal(store.list(owner)[0].semantic, false);
  assert.match(store.list(owner)[0].warning!, /Keyword/);
  assert.equal(store.chunks(owner)[0].documentId, id);
  worker.stop();
  store.close();
});
