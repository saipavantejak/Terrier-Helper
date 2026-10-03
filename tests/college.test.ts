import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { Store } from "../backend/store.js";
import { createApp } from "../backend/app.js";
import type { Provider } from "../backend/provider.js";
import { institutionOwner } from "../backend/institution.js";
const adminKey = "test-only-admin-access-key-32-characters";
const provider: Provider = {
  enabled: true,
  embeddingModel: "fixture",
  embed: async () => [],
  answer: async (_q, evidence) => ({
    output: {
      status: "answered",
      claims: [
        {
          text: evidence[0].text,
          evidence: [{ sourceId: evidence[0].id, quote: evidence[0].text }],
        },
      ],
    },
    tokens: 1,
  }),
  verify: async () => ({ supported: [true], tokens: 1 }),
};
test("college publication boundary, admin authentication, and private-data isolation", async () => {
  const store = new Store(":memory:");
  try {
    const app = createApp(store, provider, undefined, { adminKey });
    const admin = request.agent(app),
      student = request.agent(app),
      other = request.agent(app);
    await admin.get("/api/workspace").expect(200);
    assert.equal((await student.get("/api/workspace")).body.role, "student");
    await other.get("/api/workspace");
    await student.post("/api/documents").send({}).expect(403);
    await student.post("/api/process").send({}).expect(403);
    await admin.post("/api/admin/login").send({ key: "wrong" }).expect(401);
    await admin
      .post("/api/admin/login")
      .set("Origin", "https://evil.example")
      .send({ key: adminKey })
      .expect(403);
    await admin.post("/api/admin/login").send({ key: adminKey }).expect(200);
    assert.equal((await admin.get("/api/workspace")).body.role, "admin");
    const owner = institutionOwner("sfc-brooklyn");
    const id = store.add(owner, "policy.pdf", Buffer.from("%PDF-test"));
    await admin
      .post(`/api/documents/${id}/publication`)
      .send({ published: true })
      .expect(409);
    store.saveChunks(
      id,
      1,
      [{ page: 1, text: "Library books may be borrowed for fourteen days." }],
      null,
      null,
      null,
    );
    assert.equal(
      (await student.get("/api/documents")).body.documents.length,
      0,
    );
    await student.get(`/api/documents/${id}/file`).expect(404);
    await student
      .post("/api/chat")
      .send({ question: "library books" })
      .expect(409);
    await student
      .post(`/api/documents/${id}/publication`)
      .send({ published: true })
      .expect(403);
    await student.delete(`/api/documents/${id}`).send({}).expect(403);
    await student.post(`/api/documents/${id}/reindex`).send({}).expect(403);
    await admin
      .post(`/api/documents/${id}/publication`)
      .send({ published: true })
      .expect(200);
    for (const browser of [student, other]) {
      assert.equal(
        (await browser.get("/api/documents")).body.documents[0].id,
        id,
      );
      await browser.get(`/api/documents/${id}/file`).expect(200);
      const chat = await browser
        .post("/api/chat")
        .send({ question: "How long can library books be borrowed?" })
        .expect(200);
      assert.match(chat.text, /fourteen days/);
    }
    const privateOwner = store.createOwner();
    const privateId = store.add(
      privateOwner,
      "private.pdf",
      Buffer.from("%PDF-private"),
    );
    store.saveChunks(
      privateId,
      1,
      [{ page: 1, text: "Private library record not for students." }],
      null,
      null,
      null,
    );
    await admin.get(`/api/documents/${privateId}/file`).expect(404);
    await student
      .post("/api/chat")
      .send({ question: "library record", documentIds: [privateId] })
      .expect(409);
    await request(app)
      .get("/api/documents")
      .set("Cookie", `terrier_owner=${owner}`)
      .expect(401);
    await admin
      .post(`/api/documents/${id}/publication`)
      .send({ published: false })
      .expect(200);
    await student.get(`/api/documents/${id}/file`).expect(404);
    await student
      .post("/api/chat")
      .send({ question: "library books" })
      .expect(409);
    store.cleanup();
    assert.ok(store.owner(owner));
    await admin.post("/api/admin/logout").send({}).expect(200);
    await admin.delete(`/api/documents/${id}`).send({}).expect(403);
  } finally {
    store.close();
  }
});
test("host identity adapter enforces institution and never trusts client role headers", async () => {
  const store = new Store(":memory:");
  try {
    const app = createApp(store, provider, undefined, {
      authenticate: async () => ({
        subject: "staff1",
        role: "admin",
        institutionId: "another-school",
      }),
    });
    await request(app).get("/api/workspace").expect(403);
    const disabled = request.agent(
      createApp(store, provider, undefined, { adminKey: "" }),
    );
    await disabled.get("/api/workspace").set("X-Role", "admin").expect(200);
    await disabled.post("/api/admin/login").send({ key: adminKey }).expect(503);
    await disabled
      .post("/api/documents")
      .set("X-Role", "admin")
      .send({})
      .expect(403);
  } finally {
    store.close();
  }
});
