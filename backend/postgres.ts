import type { FeedbackRecord } from "./feedback.js";
import { documentLimits } from "./limits.js";
import pg from "pg";
import crypto from "node:crypto";
import { tokens } from "./retrieval.js";
import type { Storage } from "./storage.js";
import type { Chunk } from "./store.js";
import type { KnowledgeDocument } from "../types.js";

export class PostgresStore implements Storage {
  pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({
      connectionString: url,
      max: 3,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 10000,
      statement_timeout: 15000,
    });
    this.pool.on("error", () =>
      console.error("Database pool connection failed"),
    );
  }
  async hasPassage(
    corpus: string,
    rule: import("./feedback.js").LearningRule,
    published: boolean,
  ) {
    return (
      (
        await this.pool.query(
          `SELECT 1 FROM documents d JOIN chunks c ON c."documentId"=d.id
      WHERE d.owner=$1 AND d.id=$2 AND d.version=$3 AND d.status='ready' AND (NOT $4::boolean OR d.published)
      AND c.page=$5 AND strpos(c.text,$6)>0 LIMIT 1`,
          [
            corpus,
            rule.documentId,
            rule.version,
            published,
            rule.page,
            rule.quote,
          ],
        )
      ).rowCount! > 0
    );
  }
  async saveFeedback(record: FeedbackRecord) {
    return (
      (
        await this.pool.query(
          "INSERT INTO feedback VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING",
          [
            record.id,
            record.corpus,
            record.actor,
            record.questionKey,
            record.createdAt,
            record.status,
            JSON.stringify(record),
          ],
        )
      ).rowCount! > 0
    );
  }
  async listFeedback(corpus: string, offset = 0): Promise<FeedbackRecord[]> {
    await this.pool.query(
      "DELETE FROM feedback WHERE corpus=$1 AND status!='approved' AND created_at<$2",
      [corpus, new Date(Date.now() - 30 * 86400000).toISOString()],
    );
    return (
      await this.pool.query(
        "SELECT data FROM feedback WHERE corpus=$1 ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET $2",
        [corpus, offset],
      )
    ).rows.map((r) => r.data);
  }
  async getFeedback(
    corpus: string,
    id: string,
  ): Promise<FeedbackRecord | undefined> {
    return (
      await this.pool.query(
        "SELECT data FROM feedback WHERE corpus=$1 AND id=$2",
        [corpus, id],
      )
    ).rows[0]?.data;
  }
  async reviewFeedback(record: FeedbackRecord) {
    return (
      (
        await this.pool.query(
          "UPDATE feedback SET status=$1,data=$2 WHERE corpus=$3 AND id=$4",
          [record.status, JSON.stringify(record), record.corpus, record.id],
        )
      ).rowCount! > 0
    );
  }
  async deleteFeedback(corpus: string, id: string) {
    return (
      (
        await this.pool.query(
          "DELETE FROM feedback WHERE corpus=$1 AND id=$2",
          [corpus, id],
        )
      ).rowCount! > 0
    );
  }
  async learningRules(corpus: string, key: string): Promise<FeedbackRecord[]> {
    return (
      await this.pool.query(
        "SELECT data FROM feedback WHERE corpus=$1 AND question_key=$2 AND status='approved' ORDER BY created_at DESC LIMIT 5",
        [corpus, key],
      )
    ).rows.map((r) => r.data);
  }
  async health() {
    await this.pool.query("SELECT 1 FROM owners LIMIT 1");
  }
  async owner(token: string | undefined) {
    return (
      !!token &&
      (
        await this.pool.query(
          "SELECT id FROM owners WHERE id=$1 AND expires>$2",
          [token, Date.now()],
        )
      ).rowCount! > 0
    );
  }
  async createOwner() {
    const token = crypto.randomBytes(32).toString("hex");
    await this.pool.query("INSERT INTO owners VALUES ($1,$2)", [
      token,
      Date.now() + 30 * 86400000,
    ]);
    return token;
  }
  async ensureInstitution(id: string) {
    await this.pool.query(
      "INSERT INTO owners(id,expires) VALUES($1,$2) ON CONFLICT(id) DO NOTHING",
      [id, Number.MAX_SAFE_INTEGER],
    );
  }
  async setPublished(owner: string, id: string, published: boolean) {
    return (
      (
        await this.pool.query(
          "UPDATE documents SET published=$3 WHERE owner=$1 AND id=$2 AND (status='ready' OR NOT $3) RETURNING id",
          [owner, id, published],
        )
      ).rowCount! > 0
    );
  }
  async cleanup() {
    await this.pool.query(
      "DELETE FROM feedback WHERE status!='approved' AND created_at<$1",
      [new Date(Date.now() - 30 * 86400000).toISOString()],
    );
    await this.pool.query("DELETE FROM owners WHERE expires<=$1", [Date.now()]);
    await this.pool.query('DELETE FROM events WHERE "createdAt"<$1', [
      new Date(Date.now() - 30 * 86400000).toISOString(),
    ]);
    await this.pool.query("DELETE FROM rate_limits WHERE expires<$1", [
      Date.now(),
    ]);
    await this.pool.query("DELETE FROM leases WHERE expires<$1", [Date.now()]);
  }
  async list(owner: string): Promise<KnowledgeDocument[]> {
    return (
      await this.pool.query(
        'SELECT id,name,version,"createdAt",status,pages,chunks,error,warning,semantic,published FROM documents WHERE owner=$1 ORDER BY "createdAt" DESC',
        [owner],
      )
    ).rows;
  }
  async add(owner: string, name: string, bytes: Buffer) {
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Serialize quota checks across replicas, including the application-wide cap.
      await client.query("SELECT pg_advisory_xact_lock(73581001)");
      const existing = await client.query(
        "SELECT id FROM documents WHERE owner=$1 AND hash=$2",
        [owner, hash],
      );
      if (existing.rowCount) {
        await client.query("COMMIT");
        return String(existing.rows[0].id);
      }
      const totals = (
        await client.query(
          "SELECT count(*) FILTER(WHERE owner=$1) n, coalesce(sum(octet_length(bytes)) FILTER(WHERE owner=$1),0) size, coalesce(sum(octet_length(bytes)),0) total FROM documents",
          [owner],
        )
      ).rows[0];
      const limits = documentLimits(owner, true);
      if (
        +totals.n >= limits.count ||
        +totals.size + bytes.length > limits.bytes ||
        +totals.total + bytes.length > limits.total
      )
        throw new Error(
          "Document storage quota reached. Delete documents before uploading more.",
        );
      const id = crypto.randomUUID();
      await client.query(
        'INSERT INTO documents(id,owner,name,hash,version,"createdAt",status,bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          id,
          owner,
          name,
          hash,
          hash.slice(0, 12),
          new Date().toISOString(),
          "queued",
          bytes,
        ],
      );
      await client.query("COMMIT");
      return id;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async file(owner: string, id: string) {
    return (
      await this.pool.query(
        "SELECT bytes,name FROM documents WHERE owner=$1 AND id=$2",
        [owner, id],
      )
    ).rows[0];
  }
  async remove(owner: string, id: string) {
    return (
      (
        await this.pool.query(
          "DELETE FROM documents WHERE owner=$1 AND id=$2",
          [owner, id],
        )
      ).rowCount! > 0
    );
  }
  async mark(id: string, status: string, error: string | null = null) {
    await this.pool.query(
      "UPDATE documents SET status=$2,error=$3,published=false,lease=NULL,lease_until=NULL,attempts=0 WHERE id=$1",
      [id, status, error],
    );
  }
  async nextJob() {
    return undefined;
  } // Cloud jobs must be explicitly owner-scoped.
  async claimJob(owner: string) {
    // Fence timed-out workers with a fresh token; retries stop after three crashes.
    await this.pool.query(
      "UPDATE documents SET status='failed', error='Indexing was interrupted repeatedly. Retry indexing.',lease=NULL WHERE owner=$1 AND status='processing' AND lease_until<now() AND attempts>=3",
      [owner],
    );
    return (
      await this.pool.query(
        `UPDATE documents SET status='processing',lease=$2,lease_until=now()+interval '5 minutes',attempts=attempts+1 WHERE id=(
      SELECT id FROM documents WHERE owner=$1 AND (status='queued' OR (status='processing' AND lease_until<now() AND attempts<3)) ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1
    ) RETURNING id,name,bytes,lease`,
        [owner, crypto.randomUUID()],
      )
    ).rows[0];
  }
  async finishJob(
    id: string,
    lease: string,
    result:
      | {
          pages: number;
          chunks: Array<{ page: number; text: string }>;
          vectors: number[][] | null;
          model: string | null;
          warning: string | null;
        }
      | { error: string },
  ) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const current = await c.query(
        "SELECT id FROM documents WHERE id=$1 AND lease=$2 AND status='processing' AND lease_until>now() FOR UPDATE",
        [id, lease],
      );
      if (current.rowCount) {
        if ("error" in result)
          await c.query(
            "UPDATE documents SET status='failed',error=$2,lease=NULL,lease_until=NULL WHERE id=$1",
            [id, result.error],
          );
        else {
          await c.query('DELETE FROM chunks WHERE "documentId"=$1', [id]);
          // A single bulk insert keeps serverless/database network round trips bounded.
          const rows = result.chunks.map((x, i) => ({
            id: crypto.randomUUID(),
            page: x.page,
            text: x.text,
            embedding: result.vectors
              ? JSON.stringify(result.vectors[i])
              : null,
          }));
          await c.query(
            `INSERT INTO chunks(id,"documentId",page,text,embedding,"embeddingModel") SELECT x.id::uuid,$1,x.page,x.text,x.embedding::vector,$3 FROM jsonb_to_recordset($2::jsonb) AS x(id text,page integer,text text,embedding text)`,
            [id, JSON.stringify(rows), result.model],
          );
          await c.query(
            "UPDATE documents SET status='ready',pages=$2,chunks=$3,semantic=$4,warning=$5,error=NULL,lease=NULL,lease_until=NULL WHERE id=$1",
            [
              id,
              result.pages,
              result.chunks.length,
              !!result.vectors,
              result.warning,
            ],
          );
        }
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async saveChunks(): Promise<void> {
    throw new Error("Use fenced cloud job completion");
  }
  async chunks(owner: string, ids?: string[]): Promise<Chunk[]> {
    return this.search(owner, ids, "", null, "");
  }
  async search(
    owner: string,
    ids: string[] | undefined,
    query: string,
    vector: number[] | null,
    model: string,
  ): Promise<Chunk[]> {
    const result = await this.pool.query(
      `WITH eligible AS MATERIALIZED (
      SELECT c.id,c."documentId",c.page,c.text,c.embedding,c."embeddingModel",c.search,d.name,d.version
      FROM chunks c JOIN documents d ON d.id=c."documentId" WHERE d.owner=$1 AND d.status='ready' AND ($2::uuid[] IS NULL OR d.id=ANY($2))
    ), lexical AS (SELECT id FROM eligible WHERE search @@ websearch_to_tsquery('english',$3) ORDER BY ts_rank_cd(search,websearch_to_tsquery('english',$3)) DESC LIMIT 50),
    semantic AS (SELECT id FROM eligible WHERE $4::vector IS NOT NULL AND embedding IS NOT NULL AND "embeddingModel"=$5 ORDER BY embedding <=> $4::vector LIMIT 50)
    SELECT id,"documentId",page,text,embedding::text,"embeddingModel",name,version FROM eligible WHERE id IN (SELECT id FROM lexical UNION SELECT id FROM semantic)`,
      [
        owner,
        ids?.length ? ids : null,
        tokens(query).join(" OR "),
        vector ? JSON.stringify(vector) : null,
        model,
      ],
    );
    return result.rows.map((r) => ({
      ...r,
      embedding: r.embedding ? JSON.parse(r.embedding) : null,
    }));
  }
  async consume(key: string, limit: number, windowMs: number) {
    const now = Date.now();
    const r = await this.pool.query(
      "INSERT INTO rate_limits VALUES($1,1,$2) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires<=$3 THEN 1 ELSE rate_limits.count+1 END, expires=CASE WHEN rate_limits.expires<=$3 THEN $2 ELSE rate_limits.expires END RETURNING count",
      [key, now + windowMs, now],
    );
    return r.rows[0].count <= limit;
  }
  async acquire(key: string, ttlMs: number) {
    const token = crypto.randomUUID();
    const r = await this.pool.query(
      "INSERT INTO leases VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET token=$2,expires=$3 WHERE leases.expires<=$4 RETURNING token",
      [key, token, Date.now() + ttlMs, Date.now()],
    );
    return r.rowCount ? token : null;
  }
  async release(key: string, token: string) {
    await this.pool.query("DELETE FROM leases WHERE key=$1 AND token=$2", [
      key,
      token,
    ]);
  }
  async record(data: Record<string, unknown>) {
    await this.pool.query("INSERT INTO events VALUES($1,$2,$3)", [
      crypto.randomUUID(),
      new Date().toISOString(),
      JSON.stringify(data),
    ]);
  }
  async close() {
    await this.pool.end();
  }
}
