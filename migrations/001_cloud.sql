CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS owners (id text PRIMARY KEY, expires bigint NOT NULL);
CREATE TABLE IF NOT EXISTS documents (
 id uuid PRIMARY KEY, owner text NOT NULL REFERENCES owners ON DELETE CASCADE,
 name text NOT NULL, hash text NOT NULL, version text NOT NULL, "createdAt" text NOT NULL,
 status text NOT NULL CHECK(status IN ('queued','processing','ready','failed')),
 pages integer NOT NULL DEFAULT 0, chunks integer NOT NULL DEFAULT 0,
 error text, warning text, semantic boolean NOT NULL DEFAULT false, bytes bytea NOT NULL,
 lease uuid, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0,
 UNIQUE(owner,hash)
);
CREATE INDEX IF NOT EXISTS documents_owner ON documents(owner);
CREATE TABLE IF NOT EXISTS chunks (
 id uuid PRIMARY KEY, "documentId" uuid NOT NULL REFERENCES documents ON DELETE CASCADE,
 page integer NOT NULL, text text NOT NULL, embedding vector(768), "embeddingModel" text,
 search tsvector GENERATED ALWAYS AS (to_tsvector('english',text)) STORED
);
CREATE INDEX IF NOT EXISTS chunks_document ON chunks("documentId");
CREATE INDEX IF NOT EXISTS chunks_search ON chunks USING gin(search);
CREATE TABLE IF NOT EXISTS events (id uuid PRIMARY KEY, "createdAt" text NOT NULL, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS rate_limits (key text PRIMARY KEY, count integer NOT NULL, expires bigint NOT NULL);
CREATE TABLE IF NOT EXISTS leases (key text PRIMARY KEY, token uuid NOT NULL, expires bigint NOT NULL);

-- Additive migration: existing private documents remain unpublished.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS documents_published_owner ON documents(owner) WHERE published AND status='ready';

-- Voluntary feedback and version-bound retrieval hints, isolated by corpus.
CREATE TABLE IF NOT EXISTS feedback (
 id uuid PRIMARY KEY, corpus text NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
 actor text NOT NULL, question_key text NOT NULL, created_at text NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','approved','dismissed')), data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS feedback_review ON feedback(corpus,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS feedback_learning ON feedback(corpus,question_key,status);
