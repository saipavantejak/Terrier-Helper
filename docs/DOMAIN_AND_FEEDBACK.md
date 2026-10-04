# Reuse the assistant across domains

The existing St. Francis College deployment remains the default. Domain changes
reuse the same retrieval, exact-quotation checks, claim verification, admin
publication boundary, storage adapters, and React widget. No model fine-tuning
is required. Feedback-driven retrieval improvement is not model training.

## Configure another deployment

Use server environment variables (never put credentials in frontend variables):

```dotenv
ASSISTANT_DOMAIN=tech
ASSISTANT_NAME=Engineering Companion
INSTITUTION_ID=example-engineering
INSTITUTION_NAME=Example Engineering
INSTITUTION_LOCATION=Internal documentation
INSTITUTION_WEBSITE=https://example.com
FEEDBACK_ENABLED=true
# Use a separate stable, random secret of at least 32 characters across replicas.
FEEDBACK_SIGNING_KEY=replace-with-a-generated-secret
# Also configure DATABASE_URL, GEMINI_API_KEY, ADMIN_ACCESS_KEY and APP_ORIGIN.
```

`ASSISTANT_DOMAIN` accepts `college`, `tech`, `medical`, and `general`.
`domain.ts` contains the presentation presets. For another field, use `general`
or pass a customized `DomainProfile` through `createApp(..., {domain})`.
Do not put factual policies in the profile: upload and publish them as documents.

Keep `INSTITUTION_ID` unique and stable per organization/knowledge base. Changing
it selects a different corpus; it does not copy or move documents. Existing SFC
installations keep `sfc-brooklyn`. Non-college defaults use domain-specific IDs,
but deployments sharing a database must still supply unique organization IDs.
The legacy `college` mode means a shared, admin-published corpus for *any* domain;
`workspace` means private per-session documents. The old mode names and API remain
compatible. `student` is the legacy reader-role name in the authentication API.

For confidential use, mount the Express factory behind verified host identity:

```ts
const assistant = createApp(store, provider, wake, {
  institution: { id: 'acme-tech', name: 'Acme', location: '', website: 'https://example.com' },
  domain: { ...domainProfiles.tech, assistantName: 'Acme Docs' },
  requireReaderAuthentication: true,
  authenticate: async (req) => {
    const identity = await verifyHostSession(req); // your actual signed session/JWT verifier
    return identity ? {
      subject: identity.id,
      role: identity.canManageKnowledge ? 'admin' : 'student',
      institutionId: 'acme-tech',
    } : null;
  },
  feedbackKey: process.env.FEEDBACK_SIGNING_KEY,
});
host.use('/knowledge', assistant);
```

The adapter is authoritative; client role headers and bootstrap admin cookies
cannot override it. `requireReaderAuthentication` fails at startup without an
adapter and rejects anonymous access when enabled. Default standalone publication
is public. This is one corpus per mounted app instance, not dynamic tenant routing
from an untrusted request header. Use separately configured instances/mounts or
an authenticated host router for multiple organizations.

The React widget reads the domain from `/workspace`. Build it with
`npm run build:widget`, install the resulting `dist-widget` package in the host,
and import its CSS. See `INTEGRATION.md` for the full mounting example:

```tsx
<TerrierHelper apiBaseUrl="/knowledge/api" homeHref="/knowledge"
  adminHref="/knowledge/admin" compact
  theme={{ primary: '#173a52', accent: '#167b67' }} />
```

`compact` avoids changing the host page title. Configure domain behavior on the
server, so all clients see the same profile. Domain presets, types, and API helpers
are exported with the widget. `Storage` and `Provider` remain explicit ports;
custom storage adapters must implement the feedback methods added in v1.2.

## How learning works

1. An answer carries a signed, 24-hour receipt bound to the reader identity and
   corpus. The receipt contains the question, recent question context, answer,
   and citations. No answer transcript is persisted by this feature at this step.
2. The reader opens **Give feedback**, chooses a rating, optionally explains,
   and explicitly consents to share that snapshot with administrators.
3. The API verifies the receipt, applies rate limits, and saves at most one
   submission per answer. Tampered, expired, and other-session receipts fail.
4. Administrators review feedback in **Feedback & reviewed learning**. They can
   dismiss/delete it or approve search terms with an exact supporting passage,
   PDF page, and current published document version.
5. For the same normalized contextual question, the newest valid approved hint
   adds search terms to retrieval. The original question goes to generation and
   verification. User comments and hints are never supplied as factual evidence.
6. Every answer still requires fresh document retrieval, exact citation checking,
   and model verification. Withdrawal, deletion, reindexing, or version changes
   disable a hint when its supporting passage is no longer valid. Disabling or
   deleting a review takes effect on subsequent queries without a redeploy.

Hints currently match an exact normalized question/context, not every semantic
paraphrase. This deliberately bounds the impact of one review. A thumbs-up alone
never promotes an answer, changes model weights, or establishes truth. Approved
hints should be tested against representative questions before broader use.

Brief/plain-language preferences are session-local React state and sent as a
validated enum. Requests such as “explain that more simply” also select that style.
Clearing the conversation resets the preference. Preferences do not become policy
facts and are not retained across users.

## Feedback API

| Route | Access | Behavior |
| --- | --- | --- |
| `POST /api/feedback` | Receipt owner | `{token,rating,note?,consent:true}`; idempotent per answer |
| `GET /api/admin/feedback?offset=0` | Admin | 50 items plus `nextOffset`; bounded pagination |
| `POST /api/admin/feedback/:id/review` | Admin | `dismissed`, or `approved` plus version-bound `rule` |
| `DELETE /api/admin/feedback/:id` | Admin | Delete snapshot and associated hint |

Ratings are `helpful` or `unhelpful`. The review rule is
`{searchQuery,documentId,version,page,quote}`. UI and API limit free-text sizes.
Notes are untrusted data and rendered as text. Audit events contain review IDs
and actors, not comments or transcripts.

`FEEDBACK_ENABLED=false` disables both new collection and learned retrieval.
Feedback requires `FEEDBACK_SIGNING_KEY` (at least 32 characters), falling back to
`ADMIN_ACCESS_KEY` for existing deployments. No process-local signing key is
created, so receipts work across replicas. Key rotation invalidates outstanding
receipts. Approved examples persist until deleted. Pending/dismissed feedback
expires after 30 days; cleanup removes it and opening its admin list also purges
expired records for that corpus. Configure the existing authenticated cleanup
cron for physical deletion without admin visits. For Vercel, set `CRON_SECRET`.

## Scaling and operations

- Use PostgreSQL/pgvector in production; SQLite is for local development. The
  idempotent additive migration is `npm run db:migrate`. Existing documents and
  publication state are preserved. Run migrations before starting updated code.
- Stateless API replicas share feedback, reviewed hints, rate limits, ingestion
  leases, and documents in PostgreSQL. Use one stable signing key per deployment.
- Feedback reads are indexed by corpus and date; learning lookups by corpus,
  normalized-question hash, and review status. Each request checks at most five
  hints; passage validation queries only the referenced document/page in storage.
- Use a managed connection pooler as replica counts grow. The current client pool
  allows three connections per process, so budget aggregate connections against
  the database limit. Do not increase limits blindly.
- Existing ingestion worker/lease support remains. Run dedicated workers for
  larger corpora and monitor provider quotas, queue age, errors, and answer
  latency. Upload sizes, document quotas, and LLM budgets remain intentional.
- PDF bytes still reside in PostgreSQL. Moving large corpora to object storage,
  adding approximate vector indexes, and load-testing target concurrency are
  future capacity work, not capabilities claimed by this change.
- CI exercises SQLite and PostgreSQL storage, reader/admin boundaries, signed
  feedback, source invalidation, citation verification, and browser workflows.
  The small synthetic retrieval suite is regression coverage, not a clinical or
  production-domain accuracy benchmark. Add a representative evaluation set for
  each new domain and verify quality before changing production retrieval rules.

## Medical profile limits

This profile is for public reference-document education, not patient records,
clinical decisions, diagnosis, or personalized treatment. It displays a prominent
notice and disables feedback collection/learning by default. A reviewed deployment
can explicitly enable feedback through `AppOptions.feedbackEnabled`, after its
operator has addressed privacy, access, retention, and professional review.
Changing a theme does not make the application HIPAA compliant or clinically
validated. Do not upload PHI or patient records into this default public app.
