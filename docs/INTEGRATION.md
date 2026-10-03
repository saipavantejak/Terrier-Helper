# Reuse TerrierHelper in another application

TerrierHelper has three independently replaceable boundaries: React UI, Express API, and storage/model adapters. Production defaults to one college per deployment. A deployment ID is configured by the operator, never selected by an untrusted browser header.

## React integration

From this repository, run `npm ci && npm run build:widget`. The `dist-widget` folder is an installable local npm package with TypeScript declarations. React is a peer dependency, so your host application's React instance is reused. It does not include a server or any API keys.

```sh
# In the host React application, using the actual relative repository path:
npm install ../Terrier-Helper/dist-widget
```

```tsx
import { TerrierHelper } from "@terrier-helper/react";
import "@terrier-helper/react/style.css";

export function CollegeHelp() {
  return (
    <TerrierHelper
      apiBaseUrl="/terrier/api"
      homeHref="/help"
      adminHref="/help/admin"
      view="student"
      compact
      theme={{ primary: "#002b5c", accent: "#c8102e" }}
    />
  );
}
```

Create a separate host route with `view="admin"` for staff. The `view` prop only changes the interface; every document mutation is independently authorized on the server. Omitting `compact` includes the campus header, introduction, and source library. All component CSS is scoped under `.terrier-app`; the package does not reset the host body or global typography. Use React 19 and a browser supporting streaming fetch. A Next.js wrapper must use `"use client"`.

Map the host's `/terrier/api/*` to the backend's `/api/*` through a same-origin reverse proxy. Preserve HTTP-only cookies, request Origin, and streaming responses; disable buffering. Set the backend `APP_ORIGIN` to the exact public host origin. The default integration deliberately uses same-origin cookies, avoiding third-party-cookie dependence. Do not embed the admin key in the component, JavaScript bundle, or proxy URL.

## Express backend inside an existing Node 24 application

Copy or retain the `backend/`, `types.ts`, and `migrations/` modules and their dependencies. Run the cloud migration before serving traffic. The factory returns an Express application that can be mounted under a prefix:

```ts
import express from "express";
import { createApp } from "./terrier/backend/app.js";
import { PostgresStore } from "./terrier/backend/postgres.js";
import { createProvider } from "./terrier/backend/provider.js";

const host = express();
const store = new PostgresStore(process.env.DATABASE_URL!);
const terrier = createApp(store, createProvider(), undefined, {
  institution: {
    id: "sfc-brooklyn",
    name: "St. Francis College",
    location: "Brooklyn, New York",
    website: "https://www.sfc.edu",
  },
  // Supply your application's existing VERIFIED session reader here.
  authenticate: async (request) => {
    const session = await readVerifiedHostSession(request);
    if (!session) return null; // public student browsing; no admin privileges
    return {
      subject: session.user.id,
      role: session.user.permissions.includes("college:documents:write")
        ? "admin"
        : "student",
      institutionId: session.user.institutionId,
    };
  },
});
host.use("/terrier", terrier); // endpoints become /terrier/api/...
```

`readVerifiedHostSession` is the integration point implemented by your host auth system (for example Microsoft Entra ID, Auth0, or Clerk). Verify its issuer, audience, signature, expiry, and server-managed role membership using the provider's SDK. Never derive admin roles from request bodies, browser localStorage, query strings, or unverified headers. A different institution ID is rejected. When an adapter is supplied it is authoritative; bootstrap admin cookies cannot bypass it. The host owns its sign-out/session revocation flow.

The standalone bootstrap key is suitable for a single deployment operator. For multiple real college staff accounts, connect the host's SSO/MFA rather than share that key.

## Configuration and portability

- `INSTITUTION_ID` is a stable namespace, e.g. `sfc-brooklyn`; changing it selects a different, initially empty corpus. It does not move documents.
- `INSTITUTION_NAME`, `INSTITUTION_LOCATION`, and `INSTITUTION_WEBSITE` control displayed institution text.
- `ADMIN_ACCESS_KEY` enables standalone admin sign-in only when at least 32 characters; generate a cryptographically random value and store it server-side. Empty means admin access is disabled.
- `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, and `EMBEDDING_MODEL` configure the model adapter.
- `Storage` and `Provider` are typed interfaces; the UI does not import either server implementation.
- For a non-React host, use the JSON/SSE API contract below or host the full app on a dedicated route. Cross-origin iframe administration is not supported by the default cookie/frame policy.

## API contract

All calls are same-origin. First call `GET /api/workspace` to establish the anonymous student session. Unsafe methods use `Content-Type: application/json` and same-origin checks. Responses include `X-Request-Id`; API responses are not cached.

| Endpoint                              | Access                   | Purpose                                                                                   |
| ------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------- |
| `GET /api/workspace`                  | Public session bootstrap | Institution, role, capabilities, visible documents                                        |
| `GET /api/documents`                  | Student/admin            | Published ready sources for students; all college drafts for admins                       |
| `GET /api/documents/:id/file`         | Authorized reader        | PDF; unpublished sources are denied to students                                           |
| `POST /api/chat`                      | Student/admin            | `{question, previousQuestion?, documentIds?}`; college answers only use published sources |
| `POST /api/admin/login`               | Rate limited             | `{key}` → HTTP-only, SameSite=Strict admin cookie, expires after 8 hours                  |
| `POST /api/admin/logout`              | Current session          | Clears the standalone admin cookie                                                        |
| `POST /api/documents`                 | Admin                    | `{name, base64}` → draft PDF, queued for indexing                                         |
| `POST /api/process`                   | Admin                    | Processes one leased cloud ingestion job                                                  |
| `POST /api/documents/:id/publication` | Admin                    | `{published: true/false}`; publishing requires successful indexing                        |
| `POST /api/documents/:id/reindex`     | Admin                    | Withdraws and queues reindexing; review and republish afterwards                          |
| `DELETE /api/documents/:id`           | Admin                    | Permanently removes the college document and its index                                    |

Chat returns server-sent events `progress`, `answer`, `done`, or `error`. Treat an error event or a connection ending without `done` as a failed response. A successful answer contains individual statements, citation IDs, exact source quotes, page numbers, document versions, retrieval mode, and request ID. Unsupported questions return `insufficient_evidence`.

## Deployment and scaling

The existing Vercel deployment uses Neon PostgreSQL + pgvector, serverless Express, and the Vite frontend. PostgreSQL holds shared publication state, rate limits, and ingestion leases across replicas. Student sessions do not own college documents, so students do not serialize each other's questions through one shared lock. Repeated files are deduplicated in the institution namespace. Documents remain until an admin removes them; anonymous student sessions and operational events expire after 30 days.

Defaults preserve bounded operating cost: 100 college documents, 80 MiB college PDF storage, 100 MiB total PDF storage, and 100 chat requests/hour/application. `INSTITUTION_DOCUMENT_LIMIT`, `INSTITUTION_STORAGE_MB`, `TOTAL_STORAGE_MB`, and `CHAT_HOURLY_LIMIT` make those operator-configurable. Raising a limit does not increase your database or model quota automatically.

For durable ingestion without an open admin tab, run `npm run worker` as a separate long-running Node 24 process with the same database, model, and institution configuration. Workers claim jobs with PostgreSQL row locks and lease fencing, so multiple processes can safely cooperate. The Vercel admin interface can also process jobs while open; interrupted jobs are reclaimable after lease expiry. Vercel functions are not used as permanent worker processes.

For larger workloads, first measure retrieval recall, p95 latency, pool saturation, token cost, and rejection/error rates against a realistic corpus. Current search is bounded by candidate counts but still performs exact vector search in the institution corpus. Move PDF bytes to object storage and benchmark HNSW plus tenant filtering before claiming large-corpus scalability. No unmeasured throughput or availability guarantee is implied by the architecture.

## Upgrade behavior

The migration is additive. Existing private browser uploads are not transferred into the college namespace or published. Administrators must deliberately upload and publish approved college sources. Publishing makes a PDF and its relevant passages accessible to public visitors; use only material approved for that audience. Existing downloaded copies or previously displayed answers cannot be recalled by withdrawing a document.
