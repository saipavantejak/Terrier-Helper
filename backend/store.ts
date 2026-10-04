import type { FeedbackRecord } from "./feedback.js";
import { documentLimits } from "./limits.js";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { KnowledgeDocument } from "../types.js";

export interface Chunk {
  id: string;
  documentId: string;
  name: string;
  version: string;
  page: number;
  text: string;
  embedding: number[] | null;
  embeddingModel: string | null;
}
export class Store {
  db: DatabaseSync;
  constructor(filename: string) {
    if (filename !== ":memory:")
      mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS owners (id TEXT PRIMARY KEY, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
        name TEXT NOT NULL, hash TEXT NOT NULL, version TEXT NOT NULL, createdAt TEXT NOT NULL,
        status TEXT NOT NULL, pages INTEGER DEFAULT 0, chunks INTEGER DEFAULT 0,
        error TEXT, warning TEXT, semantic INTEGER DEFAULT 0, bytes BLOB NOT NULL,
        UNIQUE(owner,hash));
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY, documentId TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        page INTEGER NOT NULL, text TEXT NOT NULL, embedding TEXT, embeddingModel TEXT);
      CREATE INDEX IF NOT EXISTS chunks_document ON chunks(documentId);
      CREATE INDEX IF NOT EXISTS documents_owner ON documents(owner);
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, createdAt TEXT NOT NULL, data TEXT NOT NULL);
    `);
    this.db.exec(`CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY, corpus TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
      actor TEXT NOT NULL, question_key TEXT NOT NULL, created_at TEXT NOT NULL,
      status TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS feedback_review ON feedback(corpus,created_at DESC,id DESC);
      CREATE INDEX IF NOT EXISTS feedback_learning ON feedback(corpus,question_key,status);`);
    const columns = this.db.prepare("PRAGMA table_info(documents)").all();
    if (!columns.some((c) => c.name === "published"))
      this.db.exec(
        "ALTER TABLE documents ADD COLUMN published INTEGER NOT NULL DEFAULT 0",
      );
    this.db
      .prepare("UPDATE documents SET status='queued' WHERE status='processing'")
      .run();
  }
  hasPassage(
    corpus: string,
    rule: import("./feedback.js").LearningRule,
    published: boolean,
  ) {
    return !!this.db
      .prepare(
        `SELECT 1 FROM documents d JOIN chunks c ON c.documentId=d.id
      WHERE d.owner=? AND d.id=? AND d.version=? AND d.status='ready' AND (?=0 OR d.published=1)
      AND c.page=? AND instr(c.text,?)>0 LIMIT 1`,
      )
      .get(
        corpus,
        rule.documentId,
        rule.version,
        published ? 1 : 0,
        rule.page,
        rule.quote,
      );
  }
  saveFeedback(record: FeedbackRecord) {
    return (
      this.db
        .prepare(
          "INSERT INTO feedback VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
        )
        .run(
          record.id,
          record.corpus,
          record.actor,
          record.questionKey,
          record.createdAt,
          record.status,
          JSON.stringify(record),
        ).changes > 0
    );
  }
  listFeedback(corpus: string, offset = 0): FeedbackRecord[] {
    this.db
      .prepare(
        "DELETE FROM feedback WHERE corpus=? AND status!='approved' AND created_at<?",
      )
      .run(corpus, new Date(Date.now() - 30 * 86400000).toISOString());
    return this.db
      .prepare(
        "SELECT data FROM feedback WHERE corpus=? ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET ?",
      )
      .all(corpus, offset)
      .map((r) => JSON.parse(String(r.data)));
  }
  getFeedback(corpus: string, id: string): FeedbackRecord | undefined {
    const row = this.db
      .prepare("SELECT data FROM feedback WHERE corpus=? AND id=?")
      .get(corpus, id);
    return row ? JSON.parse(String(row.data)) : undefined;
  }
  reviewFeedback(record: FeedbackRecord) {
    return (
      this.db
        .prepare("UPDATE feedback SET status=?,data=? WHERE corpus=? AND id=?")
        .run(record.status, JSON.stringify(record), record.corpus, record.id)
        .changes > 0
    );
  }
  deleteFeedback(corpus: string, id: string) {
    return (
      this.db
        .prepare("DELETE FROM feedback WHERE corpus=? AND id=?")
        .run(corpus, id).changes > 0
    );
  }
  learningRules(corpus: string, key: string): FeedbackRecord[] {
    return this.db
      .prepare(
        "SELECT data FROM feedback WHERE corpus=? AND question_key=? AND status='approved' ORDER BY created_at DESC LIMIT 5",
      )
      .all(corpus, key)
      .map((r) => JSON.parse(String(r.data)));
  }
  owner(token: string | undefined): boolean {
    return (
      !!token &&
      !!this.db
        .prepare("SELECT id FROM owners WHERE id=? AND expires>?")
        .get(token, Date.now())
    );
  }
  createOwner() {
    const token = crypto.randomBytes(32).toString("hex");
    this.db
      .prepare("INSERT INTO owners VALUES (?,?)")
      .run(token, Date.now() + 30 * 86400000);
    return token;
  }
  ensureInstitution(id: string) {
    this.db
      .prepare(
        "INSERT INTO owners(id,expires) VALUES(?,?) ON CONFLICT(id) DO NOTHING",
      )
      .run(id, Number.MAX_SAFE_INTEGER);
  }
  setPublished(owner: string, id: string, published: boolean) {
    return (
      this.db
        .prepare(
          "UPDATE documents SET published=? WHERE owner=? AND id=? AND (status='ready' OR ?=0)",
        )
        .run(published ? 1 : 0, owner, id, published ? 1 : 0).changes > 0
    );
  }
  cleanup() {
    this.db
      .prepare("DELETE FROM feedback WHERE status!='approved' AND created_at<?")
      .run(new Date(Date.now() - 30 * 86400000).toISOString());
    this.db.prepare("DELETE FROM owners WHERE expires<=?").run(Date.now());
    this.db
      .prepare("DELETE FROM events WHERE createdAt<?")
      .run(new Date(Date.now() - 30 * 86400000).toISOString());
  }
  list(owner: string): KnowledgeDocument[] {
    return (
      this.db
        .prepare(
          "SELECT id,name,version,createdAt,status,pages,chunks,error,warning,semantic,published FROM documents WHERE owner=? ORDER BY createdAt DESC",
        )
        .all(owner) as unknown as KnowledgeDocument[]
    ).map((d) => ({ ...d, semantic: !!d.semantic, published: !!d.published }));
  }
  add(owner: string, name: string, bytes: Buffer) {
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");
    const existing = this.db
      .prepare("SELECT id FROM documents WHERE owner=? AND hash=?")
      .get(owner, hash);
    if (existing) return String(existing.id);
    const total = this.db
      .prepare(
        "SELECT COUNT(*) n, COALESCE(SUM(length(bytes)),0) size FROM documents WHERE owner=?",
      )
      .get(owner)!;
    const global = this.db
      .prepare("SELECT COALESCE(SUM(length(bytes)),0) size FROM documents")
      .get()!;
    const limits = documentLimits(owner, false);
    if (
      Number(total.n) >= limits.count ||
      Number(total.size) + bytes.length > limits.bytes ||
      Number(global.size) + bytes.length > limits.total
    )
      throw new Error(
        "Document storage quota reached. Delete documents before uploading more.",
      );
    const id = crypto.randomUUID();
    this.db
      .prepare(
        "INSERT INTO documents(id,owner,name,hash,version,createdAt,status,bytes) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        owner,
        name,
        hash,
        hash.slice(0, 12),
        new Date().toISOString(),
        "queued",
        bytes,
      );
    return id;
  }
  file(owner: string, id: string) {
    return this.db
      .prepare("SELECT bytes,name FROM documents WHERE owner=? AND id=?")
      .get(owner, id);
  }
  remove(owner: string, id: string) {
    return (
      this.db
        .prepare("DELETE FROM documents WHERE owner=? AND id=?")
        .run(owner, id).changes > 0
    );
  }
  nextJob() {
    return this.db
      .prepare(
        "SELECT id,name,bytes FROM documents WHERE status='queued' ORDER BY createdAt LIMIT 1",
      )
      .get();
  }
  mark(id: string, status: string, error: string | null = null) {
    this.db
      .prepare("UPDATE documents SET status=?,error=?,published=0 WHERE id=?")
      .run(status, error, id);
  }
  saveChunks(
    id: string,
    pages: number,
    chunks: Array<{ page: number; text: string }>,
    embeddings: number[][] | null,
    model: string | null,
    warning: string | null,
  ) {
    if (!this.db.prepare("SELECT id FROM documents WHERE id=?").get(id)) return;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM chunks WHERE documentId=?").run(id);
      const insert = this.db.prepare("INSERT INTO chunks VALUES(?,?,?,?,?,?)");
      chunks.forEach((c, i) =>
        insert.run(
          crypto.randomUUID(),
          id,
          c.page,
          c.text,
          embeddings ? JSON.stringify(embeddings[i]) : null,
          model,
        ),
      );
      this.db
        .prepare(
          "UPDATE documents SET status='ready',pages=?,chunks=?,semantic=?,warning=?,error=NULL WHERE id=?",
        )
        .run(pages, chunks.length, embeddings ? 1 : 0, warning, id);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  chunks(owner: string, ids?: string[]): Chunk[] {
    const rows = this.db
      .prepare(
        `SELECT c.*, d.name,d.version FROM chunks c JOIN documents d ON d.id=c.documentId WHERE d.owner=? AND d.status='ready'`,
      )
      .all(owner);
    return rows
      .filter((r) => !ids?.length || ids.includes(String(r.documentId)))
      .map((r) => ({
        ...r,
        embedding: r.embedding ? JSON.parse(String(r.embedding)) : null,
      })) as unknown as Chunk[];
  }
  record(data: Record<string, unknown>) {
    this.db
      .prepare("INSERT INTO events VALUES(?,?,?)")
      .run(crypto.randomUUID(), new Date().toISOString(), JSON.stringify(data));
  }
  health() {
    this.db.prepare("SELECT 1").get();
  }
  close() {
    this.db.close();
  }
}
