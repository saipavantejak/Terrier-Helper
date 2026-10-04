import { useCallback, useEffect, useId, useState } from "react";
import { api } from "./geminiService";
import type { FeedbackRecord } from "./backend/feedback";
import type { KnowledgeDocument } from "./types";
export default function FeedbackAdmin({
  base,
  documents,
}: {
  base: string;
  documents: KnowledgeDocument[];
}) {
  const [records, setRecords] = useState<FeedbackRecord[]>([]);
  const [offset, setOffset] = useState(0);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const data = await api<{
        records: FeedbackRecord[];
        nextOffset: number | null;
      }>(`/api/admin/feedback?offset=${offset}`, { signal }, base);
      setRecords(data.records);
      setNext(data.nextOffset);
    },
    [base, offset],
  );
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    refresh(c.signal)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [refresh]);
  return (
    <section className="feedback-admin" aria-label="Feedback review">
      <h2>Feedback & reviewed learning</h2>
      <p>
        Review the original question and evidence. An approved search hint helps
        retrieve sources for the same question; it never supplies an answer. New
        questions still use normal retrieval.
      </p>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p role="status">Loading feedback…</p>
      ) : records.length ? (
        records.map((record) => (
          <Review
            key={record.id}
            record={record}
            documents={documents}
            base={base}
            refresh={refresh}
          />
        ))
      ) : (
        <p>No feedback on this page.</p>
      )}
      <div className="document-actions">
        <button
          disabled={loading || offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          Previous feedback
        </button>
        <button
          disabled={loading || next === null}
          onClick={() => {
            if (next !== null) setOffset(next);
          }}
        >
          Next feedback
        </button>
        <button
          disabled={loading}
          onClick={() => refresh().catch((e) => setError(e.message))}
        >
          Refresh feedback
        </button>
      </div>
    </section>
  );
}
function Review({
  record,
  documents,
  base,
  refresh,
}: {
  record: FeedbackRecord;
  documents: KnowledgeDocument[];
  base: string;
  refresh: () => Promise<void>;
}) {
  const id = useId();
  const [documentId, setDocument] = useState(record.rule?.documentId || "");
  const [searchQuery, setQuery] = useState(record.rule?.searchQuery || "");
  const [quote, setQuote] = useState(record.rule?.quote || "");
  const [page, setPage] = useState(record.rule?.page || 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function act(action: "approved" | "dismissed" | "delete") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const doc = documents.find((d) => d.id === documentId);
      await api(
        `/api/admin/feedback/${record.id}${action === "delete" ? "" : "/review"}`,
        {
          method: action === "delete" ? "DELETE" : "POST",
          body: JSON.stringify(
            action === "delete"
              ? {}
              : {
                  status: action,
                  ...(action === "approved"
                    ? {
                        rule: {
                          searchQuery,
                          quote,
                          page,
                          documentId,
                          version: doc?.version,
                        },
                      }
                    : {}),
                },
          ),
        },
        base,
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save review.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="document-card">
      <h3>{record.snapshot.question}</h3>
      <p>
        {record.rating} · {record.status} ·{" "}
        {new Date(record.createdAt).toLocaleDateString()}
      </p>
      {record.snapshot.context && (
        <details>
          <summary>Earlier question context</summary>
          <p>{record.snapshot.context}</p>
        </details>
      )}
      <p>
        {record.snapshot.answer.status === "insufficient_evidence"
          ? "The assistant found insufficient evidence."
          : record.snapshot.answer.statements.map((s) => s.text).join(" ")}
      </p>
      <p>
        <strong>User feedback:</strong>{" "}
        {record.note || "No additional comment."}
      </p>
      <details>
        <summary>Original source quotations</summary>
        {record.snapshot.answer.citations.map((c) => (
          <blockquote key={c.id}>
            {c.quote}
            <br />
            {c.name} · p. {c.page} · {c.version}
          </blockquote>
        ))}
      </details>
      <details>
        <summary>
          {record.status === "approved"
            ? "Edit reviewed search hint"
            : "Review a document-backed search hint"}
        </summary>
        <form
          className="review-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act("approved");
          }}
        >
          <label htmlFor={id + "-query"}>
            Document search terms (not an answer)
          </label>
          <input
            id={id + "-query"}
            required
            minLength={3}
            maxLength={300}
            value={searchQuery}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label htmlFor={id + "-doc"}>Published supporting document</label>
          <select
            id={id + "-doc"}
            required
            value={documentId}
            onChange={(e) => setDocument(e.target.value)}
          >
            <option value="">Choose a source</option>
            {documents
              .filter((d) => d.published && d.status === "ready")
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </select>
          {documentId && (
            <a
              href={`${base}/documents/${documentId}/file`}
              target="_blank"
              rel="noreferrer"
            >
              Review selected PDF ↗
            </a>
          )}
          <label htmlFor={id + "-page"}>PDF page</label>
          <input
            id={id + "-page"}
            type="number"
            required
            min={1}
            max={300}
            value={page}
            onChange={(e) => setPage(Number(e.target.value))}
          />
          <label htmlFor={id + "-quote"}>Exact supporting passage</label>
          <textarea
            id={id + "-quote"}
            required
            minLength={20}
            maxLength={2000}
            value={quote}
            onChange={(e) => setQuote(e.target.value)}
          />
          <p className="feedback-note">
            Check that these terms retrieve the intended topic. Approval does
            not establish clinical validity or replace expert review. The source
            must remain published at this version.
          </p>
          <button className="primary-button" disabled={busy}>
            Approve search hint
          </button>
        </form>
      </details>
      {error && <p role="alert">{error}</p>}
      <div className="document-actions">
        <button disabled={busy} onClick={() => void act("dismissed")}>
          {record.status === "approved"
            ? "Disable search hint"
            : "Dismiss feedback"}
        </button>
        <button
          className="danger-button"
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                "Delete this feedback and any associated search hint?",
              )
            )
              void act("delete");
          }}
        >
          Delete feedback
        </button>
      </div>
    </article>
  );
}
