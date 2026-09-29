# Deploy TerrierHelper on Vercel

This repository has two entry points: `server.ts` for local/Docker SQLite use, and `api/handler.ts` for Vercel + PostgreSQL. Vercel never writes documents into its local filesystem. `vercel.json` serves the Vite frontend and rewrites API requests to Express.

## Setup from a phone

1. In Vercel, import `saipavantejak/Terrier-Helper`, select the repository root, and keep the **Vite** preset and **Node 24**. The repository specifies the build and output settings. Enable Fluid Compute (normally enabled on new projects).
2. Connect a dedicated **Neon PostgreSQL** database through the project's Storage/Marketplace page. Choose an available free plan if appropriate; review its current limits before accepting. Use a pooled connection string as **DATABASE_URL**. PostgreSQL must support the `vector` extension. Do not connect an unrelated application's database.
3. In Settings → Environment Variables, add the following for **Production**:

| Name | Value |
| --- | --- |
| `DATABASE_URL` | Dedicated PostgreSQL pooled connection string; integration may create this automatically |
| `GEMINI_API_KEY` | Your Google AI Studio key; never use a `VITE_` prefix |
| `GEMINI_MODEL` | A model available to your account; code defaults to `gemini-3.8-flash` |
| `EMBEDDING_MODEL` | `gemini-embedding-001` (768 dimensions) |
| `CRON_SECRET` | A randomly generated secret of at least 32 characters |
| `APP_ORIGIN` | Exact final production origin, e.g. `https://your-project.vercel.app` |

4. Deploy. `npm run vercel:build` runs an idempotent, transaction-locked schema migration and then the production build. A missing database or unavailable pgvector extension fails the build explicitly. Set the final `APP_ORIGIN` after Vercel assigns the domain and redeploy. Without this variable, the API uses the request's HTTPS host.
5. Open `/api/health` on the resulting domain: it must return `{"status":"ok"}`. Open the homepage and perform the acceptance checks below.

Do not put database credentials or API keys in GitHub, frontend build variables, screenshots, or chat. Environment changes require redeployment. Preview deployments must use a separate development database and their own matching origin; do not expose production credentials to untrusted pull requests.

The repository being ready for deployment is not evidence that a deployment exists. Confirm the deployment is Ready and verify the resulting URL.

## Mobile acceptance checks

- Upload a text PDF smaller than **3 MB**. Keep the page open until it becomes Ready. Ask a question answered by a specific passage, open its citation, and check its page and exact quote.
- Ask a question outside the document. Expect insufficient evidence rather than invented information.
- Reload. The PDF should still be present. Open an incognito window: it should have an empty, separate workspace.
- Delete the PDF. Its file URL must no longer work; subsequent questions cannot use it.
- On a temporary test deployment, remove the model key and redeploy. Generation must show unavailable; uploads and keyword indexing still work. Restore the key and reindex to add semantic search.

## Operational behavior and limits

- Maximum PDF: **3 MiB**, 300 pages, 500 chunks. Base64 expansion remains below Vercel's 4.5 MB function payload limit. Larger files require a future private object-storage direct-upload flow.
- Maximum workspace: 10 PDFs / 20 MiB of original bytes. Application-wide: 100 MiB of original bytes. Extracted text, vectors, database overhead, and backups are additional.
- Small original PDFs use PostgreSQL `bytea`, keeping ownership, deletion, and quota checks transactional. This is a deliberate bounded-demo tradeoff. Move originals to private object storage before increasing limits or scale.
- Browser polling requests `/api/process`; each request awaits one owner-scoped job. PostgreSQL leases prevent simultaneous processing within a workspace. A killed invocation can be reclaimed after five minutes; fencing prevents stale workers from overwriting a retry or deleted document. After three interrupted attempts the document fails visibly. Reopen the page to resume: this is not an autonomous always-running queue.
- Function duration: 300 seconds. Embeddings have a 210-second total cancellation budget; failures preserve keyword indexing. Answer generation has a 90-second cancellation budget.
- Distributed database rate limits supplement local IP limits: uploads 8/minute/workspace, chat 15/minute/workspace and 100/hour/application, one active answer/workspace. Limits are a demo abuse control, not an authentication substitute or hard provider-spend guarantee. Configure provider budgets and Vercel spend controls.
- Cloud search retrieves at most 50 lexical and 50 semantic candidates using PostgreSQL full-text search and exact pgvector cosine distance within owned, ready documents. Application BM25 and cosine RRF rerank this candidate set. This differs from local SQLite's full-workspace candidate scan; the synthetic local benchmark does not measure cloud candidate recall. pgvector exact search avoids approximate-index filtering surprises at this bounded size; benchmark before adding HNSW.
- Daily authenticated Vercel Cron removes expired workspaces and telemetry. Access ends at 30 days; physical application deletion follows the next successful daily cleanup. Monitor cron failures. Database backups have a separate retention policy.
- `/api/health` checks database/schema access, not model availability. Operational events include request ID, latency, status and token usage, excluding questions and source text. Use Vercel runtime logs and database events to investigate errors without logging secrets.

## Tests and maintenance

CI starts PostgreSQL 17 with pgvector, runs real database integration checks plus existing unit/API/browser checks. To run those database tests locally, supply `TEST_DATABASE_URL` pointing to a **disposable test database**. Never point tests at production.

Current migrations are additive and idempotent. For future changes, use versioned migrations and backward-compatible expand/contract steps before rolling deployments. Restrict the runtime database role and separate migration privileges before an institutional production rollout. Back up and restore-test your database. No SSO, OCR, autonomous durable queue, large-corpus load test, or human-reviewed answer-quality certification is claimed.

References: [Vercel function limits](https://vercel.com/docs/functions/limitations), [pgvector](https://github.com/pgvector/pgvector).


### Gemini generation diagnostics

`npm run diagnose:gemini` performs two small, synthetic generation requests using the server-side Gemini key and configured primary/fallback models. It prints model IDs, response status, and sanitized errors, never the key or uploaded documents. Run it only when diagnosing provider availability; normal deployments do not make these calls. These requests may consume provider quota.

On September 29, 2026, a minimal production deployment probe isolated a 503 on `gemini-3.8-flash`: Google reported high demand. `gemini-3.5-flash` responded, and the live RAG workflow subsequently returned the known fourteen-day borrowing period with an exact quotation and page citation. This confirms recovery through the existing same-provider fallback, not a guarantee of future provider availability.
