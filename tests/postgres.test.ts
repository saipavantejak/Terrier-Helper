import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import request from "supertest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { PostgresStore } from "../backend/postgres";
import { createApp } from "../backend/app";
import type { Provider } from "../backend/provider";
const url = process.env.TEST_DATABASE_URL;
const noAI: Provider = {
  enabled: false,
  embeddingModel: "fixture",
  embed: async () => [],
  answer: async () => {
    throw Error("disabled");
  },
  verify: async () => {
    throw Error("disabled");
  },
};
test(
  "PostgreSQL cloud flow: upload, request-bound indexing, search, isolation, leases, deletion",
  { skip: !url },
  async () => {
    const store = new PostgresStore(url!);
    const replica = new PostgresStore(url!);
    const owners: string[] = [];
    try {
      await store.pool.query(
        await readFile(
          new URL("../migrations/001_cloud.sql", import.meta.url),
          "utf8",
        ),
      );
      const app = createApp(store, noAI, undefined, { mode: "workspace" }),
        agent = request.agent(app),
        stranger = request.agent(
          createApp(replica, noAI, undefined, { mode: "workspace" }),
        );
      const ws = await agent.get("/api/workspace").expect(200);
      owners.push(ws.headers["set-cookie"][0].split(";")[0].split("=")[1]);
      const ws2 = await stranger.get("/api/workspace").expect(200);
      owners.push(ws2.headers["set-cookie"][0].split(";")[0].split("=")[1]);
      assert.equal(ws.body.maxUploadMB, 3);
      assert.equal(ws.body.requestProcessing, true);
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      pdf
        .addPage()
        .drawText(
          "Tuition payment deadline is September 15. Contact the bursar office.",
          { font, size: 12 },
        );
      const bytes = Buffer.from(await pdf.save());
      const upload = await agent
        .post("/api/documents")
        .send({ name: "Policy.pdf", base64: bytes.toString("base64") })
        .expect(202);
      const id = upload.body.id;
      await stranger.get(`/api/documents/${id}/file`).expect(404);
      await stranger.post(`/api/documents/${id}/reindex`).send({}).expect(404);
      await stranger.delete(`/api/documents/${id}`).send({}).expect(404);
      await agent.post("/api/process").send({}).expect(200);
      assert.equal((await replica.list(owners[0]))[0].status, "ready");
      const hits = await replica.search(
        owners[0],
        undefined,
        "tuition deadline",
        null,
        "fixture",
      );
      assert.equal(hits.length, 1);
      assert.equal(hits[0].page, 1);
      assert.equal(
        (await replica.search(owners[1], [id], "tuition", null, "fixture"))
          .length,
        0,
      );
      await agent
        .get(`/api/documents/${id}/file`)
        .expect("Content-Type", /pdf/)
        .expect(200);
      await store.mark(id, "queued");
      const claims = await Promise.all([
        store.claimJob(owners[0]),
        replica.claimJob(owners[0]),
      ]);
      assert.equal(
        claims.filter(Boolean).length,
        1,
        "only one replica claims the job",
      );
      const old = claims.find(Boolean)!;
      await store.pool.query(
        "UPDATE documents SET lease_until=now()-interval '1 second' WHERE id=$1",
        [id],
      );
      const fresh = await replica.claimJob(owners[0]);
      assert.ok(fresh);
      assert.notEqual(fresh.lease, old.lease);
      await store.finishJob(id, old.lease, { error: "stale worker" });
      assert.equal((await store.list(owners[0]))[0].status, "processing");
      const v = Array(768).fill(0);
      v[0] = 1;
      await replica.finishJob(id, fresh.lease, {
        pages: 1,
        chunks: [
          { page: 1, text: "Tuition payment deadline is September 15." },
        ],
        vectors: [v],
        model: "fixture",
        warning: null,
      });
      assert.equal(
        (
          await store.search(
            owners[0],
            undefined,
            "unrelated synonym",
            v,
            "fixture",
          )
        ).length,
        1,
      );
      assert.equal(
        (
          await store.search(
            owners[0],
            undefined,
            "unrelated synonym",
            v,
            "wrong-model",
          )
        ).length,
        0,
      );
      const key = "test:" + owners[0];
      assert.deepEqual(
        (
          await Promise.all([
            store.consume(key, 1, 60000),
            replica.consume(key, 1, 60000),
          ])
        ).sort(),
        [false, true],
      );
      const lease = await store.acquire(key, 60000);
      assert.ok(lease);
      assert.equal(await replica.acquire(key, 60000), null);
      await replica.release(key, "00000000-0000-0000-0000-000000000000");
      assert.equal(await store.acquire(key, 60000), null);
      await store.release(key, lease!);
      assert.ok(await replica.acquire(key, 60000));
      await store.mark(id, "queued");
      const deleted = await store.claimJob(owners[0]);
      await agent.delete(`/api/documents/${id}`).send({}).expect(200);
      await store.finishJob(id, deleted.lease, { error: "late worker" });
      assert.equal((await replica.list(owners[0])).length, 0);
      await agent.get("/api/documents/not-a-uuid/file").expect(400);
      await agent
        .post("/api/documents")
        .send({
          name: "large.pdf",
          base64: Buffer.concat([
            Buffer.from("%PDF-"),
            Buffer.alloc(3 * 1024 ** 2),
          ]).toString("base64"),
        })
        .expect(400);
    } finally {
      for (const owner of owners)
        await store.pool.query("DELETE FROM owners WHERE id=$1", [owner]);
      await store.close();
      await replica.close();
    }
  },
);
