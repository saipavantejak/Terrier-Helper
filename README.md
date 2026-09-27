# TerrierHelper

An independent college-document assistant built with React, TypeScript, Express, PostgreSQL/pgvector (Vercel), SQLite (local), PDF.js, and Gemini. Upload PDFs, retrieve relevant passages, and inspect page-level evidence behind each answer. This project is not an official St. Francis College service.

## What the application does

- Extracts PDF text per page and builds overlapping passages (220 words, 35-word overlap).
- Persists original PDFs, passage text, embeddings, ingestion state, and content-hash versions in persistent storage.
- Combines BM25 keyword retrieval and Gemini embedding similarity using reciprocal rank fusion. Deduplicates overlapping results and limits the context sent to the model.
- Returns structured claims with exact source quotes. Rejects nonexistent sources and quotes absent from retrieved text, then runs a separate model-based support check. Unsupported claims cause the answer to be withheld.
- Streams progress events, then delivers the checked answer and citations atomically. Explicit errors distinguish failed/interrupted requests from complete answers.
- Provides document filters, PDF page links, ingestion progress, deletion, deduplication, reindexing, and an explicit keyword fallback when semantic indexing is unavailable.
- Uses high-entropy HttpOnly, SameSite browser-workspace cookies, server-side ownership checks, same-origin checks, upload limits, API rate limits, and safe React text rendering.

**Verification is fallible.** Exact quote checks establish source provenance, not truth or semantic entailment. The second model check can also make mistakes. Users must inspect sources before acting on consequential policy advice.

## Deploy on Vercel

See [the phone-friendly deployment guide](docs/VERCEL.md) for database connection, server-only secrets, automatic migrations, and mobile acceptance checks. See [technology decisions and interview answers](docs/TECHNOLOGY-DECISIONS.md) for alternatives and tradeoffs. Cloud uses PostgreSQL/pgvector, bounded request-driven ingestion with fenced leases, distributed limits, and daily retention cleanup. Deployment requires account access and credentials; source code alone is not a live deployment.

## Run locally

Use **Node 24 LTS**.

```bash
git clone https://github.com/saipavantejak/Terrier-Helper.git
cd Terrier-Helper
npm ci
cp .env.example .env
# Set GEMINI_API_KEY in .env; do not commit credentials.
npm run dev
```

Open http://localhost:3000. Without a key, uploads and keyword indexing work, but answer generation is explicitly disabled. No fake AI responses are substituted.

Configuration:

| Variable          | Default                | Purpose                                                                   |
| ----------------- | ---------------------- | ------------------------------------------------------------------------- |
| `GEMINI_API_KEY`  | none                   | Gemini credential, server only; legacy `API_KEY` also accepted            |
| `GEMINI_MODEL`    | `gemini-3.8-flash`     | Configurable answer and verification model; ensure access in your account |
| `EMBEDDING_MODEL` | `gemini-embedding-001` | 768-dimensional embeddings; reindex existing documents after changes      |
| `DATABASE_PATH`   | `data/terrier.sqlite`  | Persistent database location                                              |
| `PORT`            | `3000`                 | HTTP port                                                                 |
| `APP_ORIGIN`      | request origin         | Exact public HTTPS origin in production                                   |
| `TRUST_PROXY`     | off                    | Set to the exact number of trusted reverse-proxy hops, if applicable      |

## Local / Docker production mode

```bash
npm ci
npm run check
npm start
```

Or build the included Dockerfile:

```bash
docker build -t terrier-helper .
docker run --env-file .env -e APP_ORIGIN=https://helper.example.com \
  -p 3000:3000 -v terrier-data:/app/data terrier-helper
```

Terminate HTTPS at a reverse proxy and configure it to support streaming responses without buffering, with a timeout over 90 seconds. Production cookies require HTTPS. Keep the container running and mount durable storage; do not deploy this SQLite architecture to ephemeral serverless functions. Configure `TRUST_PROXY` only for your actual proxy topology.

The **SQLite entry point** targets one long-lived server instance. Vercel uses the separate PostgreSQL entry point described above. SQLite-backed ingestion resumes queued/interrupted jobs at startup, with one job processed at a time. Rate limits and generation concurrency limits are local to that process. For horizontal scale, migrate storage and job claiming to a shared database/queue, use distributed rate limits, and add indexed vector search. Current vector and BM25 scoring scan the workspace's bounded passage collection.

`GET /api/health` verifies database access. `events` stores request IDs, answer status, latency, token totals, and retrieval mode without questions or source text. Inspect these operational records using an administrator's SQLite tooling. Token totals cover generation and verification, not embedding usage; dollar cost requires provider billing/rate data. Set up external uptime/error monitoring and encrypted database backups before a public launch.

## Ownership and retention

Each browser receives a random workspace token in an HttpOnly cookie. It expires after 30 days. Workspace files and indexes are removed by periodic cleanup (within an additional hour locally, or the next successful daily cloud cron) or immediately by document deletion at the application level. SQLite secure deletion is enabled; backups and filesystem snapshots need their own retention policy.

These are **anonymous browser-owned workspaces, not institutional user accounts or SSO**. Clearing cookies loses access; there is no cross-device recovery. Add verified institutional authentication and an explicit access model before handling student records or shared private collections. Do not upload sensitive personal information to this demonstration deployment.

PDF text is sent to Google for embeddings and answer/verification requests when AI is configured. Uploaded documents are untrusted content, not verified official publications. Content-hash versions distinguish uploads but do not establish policy effective dates or authority. The model is instructed to expose conflicts rather than assume the newest upload is authoritative.

Local limits: 10 MB and 300 pages per PDF; 1,500 passages per document; 30 documents and 100 MB of original PDFs per workspace; 1 GB total original PDFs per instance. Text, embedding, WAL and backup storage are additional. Image-only/scanned documents require external OCR; pages with no text generate a warning. Complex tables, diagrams, and multi-column reading order are not guaranteed by text extraction.

## Verification

```bash
npm run typecheck
npm test
npm run eval
npm run build
npx playwright install chromium
npm run test:browser
# typecheck, unit/integration tests, retrieval evaluation, build:
npm run check
```

CI also starts a real PostgreSQL/pgvector service and checks cloud upload, request-bound ingestion, cross-workspace isolation, vector model filtering, concurrent job claiming, stale-worker fencing, distributed rate limits, and deletion during processing. These tests skip locally unless `TEST_DATABASE_URL` names a disposable database.

Tests cover PDF extraction, indexing fallback, persistence, ownership, deletion, input validation, source quote validation, unsupported-claim refusal, provider failures, API streaming completion, and safe HTML rendering. Model responses in tests are controlled fixtures, not live Gemini calls. Playwright checks the production UI upload/index/persist/filter/delete flow, mobile overflow, and citation rendering against a model response fixture. CI runs these browser checks on Ubuntu.

`eval/fixtures.ts` contains **synthetic policies**, 24 answerable questions and 4 out-of-domain questions. `npm run eval` reports Recall@3, MRR@3 and empty-retrieval rate. This is a small regression baseline, not evidence of real SFC accuracy, calibrated confidence, or production reliability. CI enforces its thresholds and runs build/tests plus a production startup smoke check.

Before claiming production answer quality, assemble 100–200 human-reviewed questions from authorized current documents with expected source pages and accepted answers. Include paraphrases, policy exceptions, conflicting versions, follow-ups, misleading documents and unanswerable questions. Measure retrieval recall, answer correctness, citation support, false-answer/refusal rates, p95 latency, and actual provider cost. Review failures rather than relying solely on another LLM's score.

## Structure

- `api/handler.ts`, `vercel.json`: Vercel API entry point, routing and retention cron
- `backend/postgres.ts`, `migrations/`: cloud database, search and distributed coordination
- `backend/store.ts`: durable ownership, documents, passages and telemetry
- `backend/ingest.ts`: page extraction and recoverable ingestion worker
- `backend/retrieval.ts`: chunking, BM25, cosine similarity, rank fusion
- `backend/provider.ts`: Gemini adapter, structured answers and evidence verification
- `backend/app.ts`: validated, owner-scoped APIs and streaming protocol
- `server.ts`: application startup, dev/production serving and shutdown
- `App.tsx`, `ChatWindow.tsx`: library, chat and evidence interface
- `tests/`, `eval/`: regression coverage and synthetic retrieval benchmark

Previous whole-PDF-per-message prompting, public source ZIP downloads, regex HTML sanitization, and the expiring in-memory document map have been removed.
