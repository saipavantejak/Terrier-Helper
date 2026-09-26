import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { Store } from "../backend/store";
import { createApp } from "../backend/app";
import type { Provider } from "../backend/provider";
function setup(
  options: {
    unsupported?: boolean;
    badQuote?: boolean;
    failure?: boolean;
    enabled?: boolean;
  } = {},
) {
  const store = new Store(":memory:");
  const provider: Provider = {
    enabled: options.enabled ?? true,
    embeddingModel: "test",
    embed: async () => [[1, 0]],
    answer: async (_question, evidence) => {
      if (options.failure) throw new Error("provider internal secret");
      return {
        output: {
          status: "answered",
          claims: [
            {
              text: "Tuition is due September 15.",
              evidence: [
                {
                  sourceId: evidence[0].id,
                  quote: options.badQuote
                    ? "A completely invented source quotation."
                    : evidence[0].text,
                },
              ],
            },
          ],
        },
        tokens: 12,
      };
    },
    verify: async () => ({ supported: [!options.unsupported], tokens: 6 }),
  };
  const app = createApp(store, provider);
  const agent = request.agent(app);
  return { store, app, agent };
}
async function seed(ctx: ReturnType<typeof setup>) {
  const response = await ctx.agent.get("/api/workspace").expect(200);
  const cookie = response.headers["set-cookie"][0] as string;
  const owner = cookie.split(";")[0].split("=")[1];
  const id = ctx.store.add(owner, "policy.pdf", Buffer.from("%PDF-test"));
  ctx.store.saveChunks(
    id,
    1,
    [{ page: 1, text: "Tuition is due on September 15." }],
    null,
    null,
    null,
  );
  return { id, owner };
}
test("unauthenticated APIs fail closed; files and deletion are isolated between workspaces", async () => {
  const ctx = setup();
  try {
    await request(ctx.app).get("/api/documents").expect(401);
    const { id } = await seed(ctx);
    const outsider = request.agent(ctx.app);
    await outsider.get("/api/workspace").expect(200);
    await outsider.get(`/api/documents/${id}/file`).expect(404);
    await outsider
      .delete(`/api/documents/${id}`)
      .set("Content-Type", "application/json")
      .expect(404);
    assert.equal(
      (await outsider.get("/api/documents")).body.documents.length,
      0,
    );
    await ctx.agent.get(`/api/documents/${id}/file`).expect(200);
  } finally {
    ctx.store.close();
  }
});
test("upload checks signatures, schemas, content type and cross-origin requests", async () => {
  const ctx = setup();
  try {
    await seed(ctx);
    await ctx.agent
      .post("/api/documents")
      .send({
        name: "bad.pdf",
        base64: Buffer.from("not a pdf").toString("base64"),
      })
      .expect(400);
    await ctx.agent
      .post("/api/documents")
      .send({ name: "bad.exe", base64: "JVBERi10ZXN0" })
      .expect(400);
    await ctx.agent.post("/api/chat").send({ question: "" }).expect(400);
    await ctx.agent
      .post("/api/chat")
      .set("Origin", "https://evil.example")
      .send({ question: "tuition" })
      .expect(403);
    await ctx.agent
      .post("/api/chat")
      .type("form")
      .send({ question: "tuition" })
      .expect(415);
  } finally {
    ctx.store.close();
  }
});
test("chat returns only verified evidence and a terminal event", async () => {
  const ctx = setup();
  try {
    await seed(ctx);
    const response = await ctx.agent
      .post("/api/chat")
      .send({ question: "What is the tuition deadline?" })
      .expect(200);
    assert.match(response.text, /event: answer/);
    assert.match(response.text, /"status":"answered"/);
    assert.match(response.text, /"page":1/);
    assert.match(response.text, /event: done/);
    assert.equal(
      ctx.store.db.prepare("SELECT COUNT(*) n FROM events").get()!.n,
      1,
    );
  } finally {
    ctx.store.close();
  }
});
test("unrelated questions abstain without fabricating citations", async () => {
  const ctx = setup();
  try {
    await seed(ctx);
    const response = await ctx.agent
      .post("/api/chat")
      .send({ question: "spaceship dinosaur" });
    assert.match(response.text, /insufficient_evidence/);
    assert.match(response.text, /"citations":\[\]/);
  } finally {
    ctx.store.close();
  }
});
test("unsupported claims are withheld", async () => {
  const ctx = setup({ unsupported: true });
  try {
    await seed(ctx);
    const response = await ctx.agent
      .post("/api/chat")
      .send({ question: "tuition deadline" });
    assert.match(response.text, /insufficient_evidence/);
    assert.ok(!response.text.includes("Tuition is due"));
  } finally {
    ctx.store.close();
  }
});
for (const scenario of [{ badQuote: true }, { failure: true }])
  test(`provider or citation errors produce explicit stream errors ${JSON.stringify(scenario)}`, async () => {
    const ctx = setup(scenario);
    try {
      await seed(ctx);
      const response = await ctx.agent
        .post("/api/chat")
        .send({ question: "tuition deadline" });
      assert.match(response.text, /event: error/);
      assert.ok(!response.text.includes("event: answer"));
      assert.ok(!response.text.includes("secret"));
    } finally {
      ctx.store.close();
    }
  });
test("deleted filters and missing credentials fail explicitly", async () => {
  const ctx = setup();
  try {
    const { id } = await seed(ctx);
    ctx.store.db.prepare("DELETE FROM documents WHERE id=?").run(id);
    await ctx.agent
      .post("/api/chat")
      .send({ question: "tuition deadline", documentIds: [id] })
      .expect(409);
  } finally {
    ctx.store.close();
  }
  const unavailable = setup({ enabled: false });
  try {
    await seed(unavailable);
    await unavailable.agent
      .post("/api/chat")
      .send({ question: "tuition deadline" })
      .expect(503);
  } finally {
    unavailable.store.close();
  }
});

test("PDF upload flows through indexing, retrieval, answer, and deletion", async () => {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const { ingestionWorker } = await import("../backend/ingest");
  const store = new Store(":memory:");
  const provider: Provider = {
    enabled: true,
    embeddingModel: "test",
    embed: async (texts) => texts.map(() => [1, 0]),
    answer: async (_question, evidence) => ({
      output: {
        status: "answered",
        claims: [
          {
            text: "Tuition is due September 15.",
            evidence: [{ sourceId: evidence[0].id, quote: evidence[0].text }],
          },
        ],
      },
      tokens: 10,
    }),
    verify: async () => ({ supported: [true], tokens: 5 }),
  };
  const worker = ingestionWorker(store, provider);
  const agent = request.agent(createApp(store, provider, worker.wake));
  try {
    await agent.get("/api/workspace").expect(200);
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf
      .addPage()
      .drawText("Tuition payment is due on September 15.", {
        x: 30,
        y: 700,
        font,
        size: 12,
      });
    const response = await agent
      .post("/api/documents")
      .send({
        name: "policy.pdf",
        base64: Buffer.from(await pdf.save()).toString("base64"),
      })
      .expect(202);
    for (let i = 0; i < 200 && !worker.idle(); i++)
      await new Promise((r) => setTimeout(r, 10));
    const documents = (await agent.get("/api/documents")).body.documents;
    assert.equal(documents[0].status, "ready");
    assert.equal(documents[0].semantic, true);
    const answer = await agent
      .post("/api/chat")
      .send({
        question: "What is the tuition deadline?",
        documentIds: [response.body.id],
      })
      .expect(200);
    assert.match(answer.text, /"retrievalMode":"hybrid"/);
    assert.match(answer.text, /September 15/);
    await agent
      .delete(`/api/documents/${response.body.id}`)
      .set("Content-Type", "application/json")
      .expect(200);
    await agent
      .post("/api/chat")
      .send({ question: "What is the tuition deadline?" })
      .expect(409);
  } finally {
    worker.stop();
    store.close();
  }
});
