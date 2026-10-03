# TerrierHelper

An independent college-document assistant built with React, TypeScript, Express, PostgreSQL/pgvector (Vercel), SQLite (local), PDF.js, and Gemini. Authorized administrators publish college PDFs; students ask questions and inspect page-level evidence behind each answer. The interface uses an SFC Brooklyn-inspired navy, red, and white theme. This project is not an official St. Francis College service.

## What the application does

- Extracts PDF text per page and builds overlapping passages (220 words, 35-word overlap).
- Persists original PDFs, passage text, embeddings, ingestion state, and content-hash versions in persistent storage.
- Combines BM25 keyword retrieval and Gemini embedding similarity using reciprocal rank fusion. Deduplicates overlapping results and limits the context sent to the model.
- Returns structured claims with exact source quotes. Rejects nonexistent sources and quotes absent from retrieved text, then runs a separate model-based support check. Unsupported claims cause the answer to be withheld.
- Streams progress events, then delivers the checked answer and citations atomically. Explicit errors distinguish failed/interrupted requests from complete answers.
- Separates `/admin` document management from the student question interface. Uploads start as drafts; only ready, explicitly published sources are available to students. Withdrawal and reindexing immediately remove a document from student retrieval.
- Provides PDF page links, ingestion progress, deletion, deduplication, reindexing, and an explicit keyword fallback when semantic indexing is unavailable.
- Exports a scoped React component and an Express factory with a verified host-authentication adapter. See [integration and scaling](docs/INTEGRATION.md) and the [administrator guide](docs/ADMIN.md).
- Uses high-entropy HttpOnly, SameSite browser-workspace cookies, server-side institution and publication checks, same-origin checks, upload limits, API rate limits, and safe React text rendering.

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
# Set GEMINI_API_KEY and a random ADMIN_ACCESS_KEY (at least 32 characters).
# Keep credentials server-side; never commit them.
npm run dev
```

Open http://localhost:3000 for students and http://localhost:3000/admin for administrators. Sign in with the configured admin key, upload a PDF, wait for indexing, review it, then publish. Without a Gemini key, administrators can still upload and use keyword indexing, but answer generation is explicitly disabled. No fake AI responses are substituted.

Configuration:

| Variable           | Default                | Purpose                                                                                         |
| ------------------ | ---------------------- | ----------------------------------------------------------------------------------------------- |
| `ADMIN_ACCESS_KEY` | none                   | Random server-only admin credential, at least 32 characters; absent means admin access disabled |
| `INSTITUTION_ID`   | `sfc-brooklyn`         | Stable shared college document namespace                                                        |
| `GEMINI_API_KEY`   | none                   | Gemini credential, server only; legacy `API_KEY` also accepted                                  |
| `GEMINI_MODEL`     | `gemini-3.5-flash`     | Configurable answer and verification model; ensure access in your account                       |
| `EMBEDDING_MODEL`  | `gemini-embedding-001` | 768-dimensional embeddings; reindex existing documents after changes                            |
| `DATABASE_PATH`    | `data/terrier.sqlite`  | Persistent database location                                                                    |
| `PORT`             | `3000`                 | HTTP port                                                                                       |
| `APP_ORIGIN`       | request origin         | Exact public HTTPS origin in production                                                         |
| `TRUST_PROXY`      | off                    | Set to the exact number of trusted reverse-proxy hops, if applicable                            |

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

The **SQLite entry point** targets one long-lived server instance. Vercel uses the separate PostgreSQL entry point described above. SQLite-backed ingestion resumes queued/interrupted jobs at startup, with one job processed at a time. Rate limits and generation concurrency limits are local to that process. For multiple instances, use the existing PostgreSQL adapter with distributed limits and fenced ingestion leases. An optional `npm run worker` process handles durable ingestion independently of an open admin tab. Current cloud vector search is exact; benchmark and add an appropriate vector index before large-corpus rollout. See [scaling boundaries](docs/INTEGRATION.md#deployment-and-scaling).

`GET /api/health` verifies database access. `events` stores request IDs, answer status, latency, token totals, and retrieval mode without questions or source text. Inspect these operational records using an administrator's SQLite tooling. Token totals cover generation and verification, not embedding usage; dollar cost requires provider billing/rate data. Set up external uptime/error monitoring and encrypted database backups before a public launch.

## Publication, access, and retention

College documents belong to the configured institution and remain until an administrator removes them. Anonymous student cookies expire after 30 days; clearing a student cookie does not remove or hide the shared college library. Expired legacy private workspaces and operational events are cleaned up periodically. Existing private uploads are **never automatically published or transferred** during upgrade.

The standalone administrator uses an 8-hour signed HttpOnly session and a server-only access key. For individual staff accounts, connect the host application's verified SSO/MFA through `createApp`'s authentication adapter. This adapter is an integration point, not a preconfigured SSO provider. Public students can read published PDFs without an institutional login, so publish only documents approved for public access.

PDF text is sent to Google for embeddings and answer/verification requests when AI is configured. Content-hash versions distinguish uploads but do not establish policy effective dates or authority. The model is instructed to expose conflicts rather than assume the newest upload is authoritative. Deletion cannot recall copies already downloaded; database backups need a separate retention policy.

Cloud defaults: 3 MiB per PDF, 300 pages, 500 passages; 100 college documents, 80 MiB college PDF bytes, 100 MiB total PDF bytes. Local defaults: 10 MiB per PDF, 1,500 passages, 500 MiB college and 1 GiB total PDF bytes. Corpus limits are operator-configurable; text, vectors, indexes and backups require additional capacity. Scanned PDFs need external OCR. Tables, diagrams, and multi-column reading order are not guaranteed by text extraction.

## Verification

```bash
npm run typecheck
npm test
npm run eval
npm run build
npm run build:widget
npx playwright install chromium
npm run test:browser
# typecheck, unit/integration tests, retrieval evaluation, build:
npm run check
```

CI also starts a real PostgreSQL/pgvector service and checks cloud upload, request-bound ingestion, cross-workspace isolation, vector model filtering, concurrent job claiming, stale-worker fencing, distributed rate limits, and deletion during processing. These tests skip locally unless `TEST_DATABASE_URL` names a disposable database.

Tests cover PDF extraction, indexing fallback, persistence, ownership, deletion, input validation, source quote validation, unsupported-claim refusal, provider failures, API streaming completion, and safe HTML rendering. Model responses in tests are controlled fixtures, not live Gemini calls. Playwright checks separate admin/student browser sessions, draft isolation, publication and withdrawal, direct upload denial, deletion, mobile overflow, and citation rendering against a model response fixture. CI runs these browser checks on Ubuntu.

`eval/fixtures.ts` contains **synthetic policies**, 24 answerable questions and 4 out-of-domain questions. `npm run eval` reports Recall@3, MRR@3 and empty-retrieval rate. This is a small regression baseline, not evidence of real SFC accuracy, calibrated confidence, or production reliability. CI enforces its thresholds and runs build/tests plus a production startup smoke check.

Before claiming production answer quality, assemble 100–200 human-reviewed questions from authorized current documents with expected source pages and accepted answers. Include paraphrases, policy exceptions, conflicting versions, follow-ups, misleading documents and unanswerable questions. Measure retrieval recall, answer correctness, citation support, false-answer/refusal rates, p95 latency, and actual provider cost. Review failures rather than relying solely on another LLM's score.

## Structure

- `api/handler.ts`, `vercel.json`: Vercel API entry point, routing and retention cron
- `backend/postgres.ts`, `migrations/`: cloud database, search and distributed coordination
- `backend/store.ts`: durable ownership, documents, passages and telemetry
- `backend/ingest.ts`: page extraction and recoverable ingestion worker
- `backend/retrieval.ts`: chunking, BM25, cosine similarity, rank fusion
- `backend/provider.ts`: Gemini adapter, structured answers and evidence verification
- `backend/app.ts`: validated, institution-scoped APIs, admin authorization, publication and streaming and streaming protocol
- `server.ts`: application startup, dev/production serving and shutdown
- `App.tsx`, `ChatWindow.tsx`, `styles/terrier.css`: campus student/admin interfaces
- `widget.tsx`, `vite.widget.config.ts`: reusable React package
- `backend/institution.ts`: institution configuration and authentication adapter
- `scripts/worker.ts`: optional long-running PostgreSQL ingestion worker
- `tests/`, `eval/`: regression coverage and synthetic retrieval benchmark

Previous whole-PDF-per-message prompting, public source ZIP downloads, regex HTML sanitization, and the expiring in-memory document map have been removed.
