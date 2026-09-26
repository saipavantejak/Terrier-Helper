import { useEffect, useRef, useState } from "react";
import ChatWindow from "./ChatWindow";
import { api, ask, uploadDocument } from "./geminiService";
import type { KnowledgeDocument, Message } from "./types";
export default function App() {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [generationEnabled, setGenerationEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState("");
  const abort = useRef<AbortController | null>(null);
  const sending = useRef(false);
  const uploadingRef = useRef(false);
  const readyDocs = documents.filter((d) => d.status === "ready");
  const indexing = documents.some(
    (d) => d.status === "queued" || d.status === "processing",
  );
  useEffect(() => {
    const controller = new AbortController();
    api<{ documents: KnowledgeDocument[]; generationEnabled: boolean }>(
      "/api/workspace",
      { signal: controller.signal },
    )
      .then((data) => {
        setDocuments(data.documents);
        setGenerationEnabled(data.generationEnabled);
        setLoaded(true);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => {
      controller.abort();
      abort.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!indexing) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      api<{ documents: KnowledgeDocument[] }>("/api/documents", {
        signal: controller.signal,
      })
        .then((data) => setDocuments(data.documents))
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        });
    }, 2000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [indexing]);
  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    setUploading(true);
    setError("");
    try {
      for (const file of files) {
        const result = await uploadDocument(file);
        setDocuments(result.documents);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  }
  async function remove(id: string) {
    setError("");
    try {
      const result = await api<{ documents: KnowledgeDocument[] }>(
        `/api/documents/${id}`,
        { method: "DELETE" },
      );
      setDocuments(result.documents);
      setSelected((s) => s.filter((i) => i !== id));
      setMessages([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    }
  }
  async function reindex(id: string) {
    try {
      await api(`/api/documents/${id}/reindex`, { method: "POST", body: "{}" });
      setDocuments((d) =>
        d.map((x) => (x.id === id ? { ...x, status: "queued" } : x)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry failed.");
    }
  }
  async function send(question: string) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setProgress("Finding relevant passages…");
    const previous = messages.filter((m) => m.role === "user").at(-1)?.content;
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role: "user", content: question },
    ]);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const answer = await ask(
        question,
        selected,
        previous,
        setProgress,
        controller.signal,
      );
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "bot", content: "", answer },
      ]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "bot",
          content: controller.signal.aborted
            ? "Request cancelled."
            : e instanceof Error
              ? e.message
              : "Request failed.",
          error: true,
        },
      ]);
    } finally {
      setBusy(false);
      sending.current = false;
      abort.current = null;
    }
  }
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="TerrierHelper home">
          <span className="brand-mark">
            T<span>h</span>
          </span>
          <span>
            Terrier<span className="brand-light">Helper</span>
          </span>
        </a>
        <span className="header-label">THE DOCUMENT WORKSPACE</span>
        <a
          href="https://www.sfc.edu"
          target="_blank"
          rel="noreferrer"
          className="college-link"
        >
          St. Francis College ↗
        </a>
      </header>
      <main>
        <div className="intro">
          <div>
            <span className="eyebrow">LESS SEARCHING. MORE UNDERSTANDING.</span>
            <h1>Find clarity in your documents.</h1>
            <p>
              A focused space to explore college policies—with the evidence
              always close by.
            </p>
          </div>
          <span className="workspace-badge">● Private browser workspace</span>
        </div>
        {error ? (
          <div className="notice error" role="alert">
            {error}
            <button onClick={() => setError("")} aria-label="Dismiss error">
              ×
            </button>
          </div>
        ) : null}
        {loaded && !generationEnabled ? (
          <div className="notice" role="status">
            Document indexing is available. Answer generation needs a Gemini API
            key configured by the operator.
          </div>
        ) : null}
        <div className="workspace-grid">
          <aside className="library-panel" aria-label="Document library">
            <div className="library-heading">
              <div>
                <span className="eyebrow">YOUR KNOWLEDGE BASE</span>
                <h2>
                  Documents <span>{documents.length}</span>
                </h2>
              </div>
            </div>
            <label className={`upload-box ${uploading ? "disabled" : ""}`}>
              <span className="upload-symbol" aria-hidden="true">
                ↥
              </span>
              <strong>{uploading ? "Uploading…" : "Add your documents"}</strong>
              <span>PDF · up to 10 MB each · 300 pages</span>
              <input
                aria-label="Upload PDF documents"
                type="file"
                accept="application/pdf,.pdf"
                multiple
                onChange={upload}
                disabled={!loaded || uploading || busy}
              />
            </label>
            <div className="scope-label">
              <span>
                {selected.length
                  ? `${selected.length} selected for questions`
                  : "Searching all ready documents"}
              </span>
              {selected.length ? (
                <button disabled={busy} onClick={() => setSelected([])}>
                  Reset
                </button>
              ) : null}
            </div>
            <div className="document-list">
              {documents.length === 0 ? (
                <div className="empty-library">
                  <span aria-hidden="true">▤</span>
                  <p>Your library starts here.</p>
                  <small>
                    Add a handbook, syllabus, or policy to ask your first
                    question.
                  </small>
                </div>
              ) : (
                documents.map((doc) => (
                  <article key={doc.id} className="document-card">
                    <div className="document-top">
                      <input
                        type="checkbox"
                        aria-label={`Use ${doc.name} for questions`}
                        checked={selected.includes(doc.id)}
                        disabled={doc.status !== "ready" || busy}
                        onChange={(e) =>
                          setSelected((s) =>
                            e.target.checked
                              ? [...s, doc.id]
                              : s.filter((id) => id !== doc.id),
                          )
                        }
                      />
                      <span className="pdf-icon">PDF</span>
                      <strong title={doc.name}>{doc.name}</strong>
                      <button
                        className="remove-button"
                        disabled={busy}
                        onClick={() => remove(doc.id)}
                        aria-label={`Delete ${doc.name}`}
                      >
                        ×
                      </button>
                    </div>
                    <div className={`document-status ${doc.status}`}>
                      {doc.status === "ready"
                        ? `${doc.pages} pages · ${doc.chunks} passages · ${doc.semantic ? "hybrid" : "keyword"}`
                        : doc.status === "failed"
                          ? "Indexing failed"
                          : "Indexing…"}
                    </div>
                    <small className="document-version">
                      Version {doc.version} ·{" "}
                      {new Date(doc.createdAt).toLocaleDateString()}
                    </small>
                    {doc.error || doc.warning ? (
                      <p className="document-warning">
                        {doc.error || doc.warning}
                      </p>
                    ) : null}
                    {doc.status === "failed" ||
                    (doc.status === "ready" &&
                      !doc.semantic &&
                      generationEnabled) ? (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => reindex(doc.id)}
                      >
                        Retry indexing
                      </button>
                    ) : null}
                  </article>
                ))
              )}
            </div>
            <div className="library-footnote">
              <strong>Your sources stay in your control.</strong>
              <p>
                Stored for up to 30 days in this browser’s workspace. Delete a
                document to remove its file and search index. Clearing browser
                cookies loses access.
              </p>
              <p>
                Document text is sent to Google for semantic indexing and
                answers when AI is configured.
              </p>
            </div>
          </aside>
          <ChatWindow
            messages={messages}
            busy={busy}
            ready={
              readyDocs.length > 0 &&
              generationEnabled &&
              (!selected.length ||
                selected.every((id) => readyDocs.some((d) => d.id === id)))
            }
            progress={progress}
            onSend={send}
            onCancel={() => abort.current?.abort()}
          />
        </div>
        <footer>
          <span>TerrierHelper · Independent student project</span>
          <button
            onClick={() => setMessages([])}
            disabled={busy || messages.length === 0}
          >
            Clear conversation
          </button>
          <span>Grounded in your sources.</span>
        </footer>
      </main>
    </div>
  );
}
