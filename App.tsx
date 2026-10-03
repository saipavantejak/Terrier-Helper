import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import ChatWindow from "./ChatWindow";
import { api, ask, uploadDocument } from "./geminiService";
import type { KnowledgeDocument, Message } from "./types";

export interface TerrierHelperProps {
  /** Same-origin API prefix; use a reverse proxy when the backend is hosted separately. */
  apiBaseUrl?: string;
  homeHref?: string;
  adminHref?: string;
  view?: "student" | "admin";
  compact?: boolean;
  theme?: { primary?: string; accent?: string };
}
interface Workspace {
  documents: KnowledgeDocument[];
  generationEnabled: boolean;
  maxUploadMB: number;
  requestProcessing: boolean;
  role: "student" | "admin";
  adminConfigured: boolean;
  hostAuthentication: boolean;
  mode: "college" | "workspace";
  institution: { name: string; location: string; website: string };
}
export default function App({
  apiBaseUrl = "/api",
  homeHref = "/",
  adminHref = "/admin",
  view,
  compact = false,
  theme,
}: TerrierHelperProps) {
  const adminView =
    view === "admin" ||
    (!view &&
      typeof window !== "undefined" &&
      /\/admin\/?$/.test(window.location.pathname));
  const [workspace, setWorkspace] = useState<Workspace>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState("");
  const [key, setKey] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const sending = useRef(false);
  const mutation = useRef(false);
  const processing = useRef(false);
  const documents = workspace?.documents ?? [];
  const admin = workspace?.role === "admin" && adminView;
  const indexing =
    admin && documents.some((d) => ["queued", "processing"].includes(d.status));
  const base = apiBaseUrl.replace(/\/$/, "");
  const reload = useCallback(
    async (signal?: AbortSignal) => {
      const data = await api<Workspace>("/api/workspace", { signal }, base);
      setWorkspace(data);
    },
    [base],
  );
  useEffect(() => {
    const controller = new AbortController();
    reload(controller.signal).catch((e) => {
      if (!controller.signal.aborted) setError(e.message);
    });
    return () => {
      controller.abort();
      abort.current?.abort();
    };
  }, [reload]);
  useEffect(() => {
    if (!indexing) return;
    const controller = new AbortController();
    const poll = async () => {
      if (processing.current) return;
      processing.current = true;
      try {
        if (workspace?.requestProcessing)
          await api(
            "/api/process",
            { method: "POST", body: "{}", signal: controller.signal },
            base,
          );
        if (!controller.signal.aborted) await reload(controller.signal);
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Indexing failed.");
      } finally {
        processing.current = false;
      }
    };
    void poll();
    const timer = setInterval(poll, 3000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [indexing, workspace?.requestProcessing, base, reload]);
  async function login(event: React.FormEvent) {
    event.preventDefault();
    setLoggingIn(true);
    setError("");
    try {
      await api(
        "/api/admin/login",
        { method: "POST", body: JSON.stringify({ key }) },
        base,
      );
      setKey("");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed.");
    } finally {
      setLoggingIn(false);
    }
  }
  async function mutate(action: () => Promise<unknown>) {
    if (mutation.current) return;
    mutation.current = true;
    setWorking(true);
    setError("");
    try {
      await action();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save changes.");
    } finally {
      mutation.current = false;
      setWorking(false);
    }
  }
  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    await mutate(async () => {
      for (const file of files)
        await uploadDocument(file, workspace?.maxUploadMB ?? 3, base);
    });
  }
  async function send(question: string) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setProgress("Finding relevant college sources…");
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
        [],
        previous,
        setProgress,
        controller.signal,
        base,
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
  const school = workspace?.institution;
  const published = documents.filter(
    (d) =>
      d.status === "ready" && (workspace?.mode === "workspace" || d.published),
  );
  const website = school?.website?.startsWith("https://")
    ? school.website
    : "https://www.sfc.edu";
  const colors: CSSProperties = {
    "--th-primary": /^#[0-9a-f]{6}$/i.test(theme?.primary || "")
      ? theme!.primary
      : "#002b5c",
    "--th-accent": /^#[0-9a-f]{6}$/i.test(theme?.accent || "")
      ? theme!.accent
      : "#c8102e",
  } as CSSProperties;
  return (
    <div className={`terrier-app${compact ? " compact" : ""}`} style={colors}>
      <header className="topbar">
        <a className="brand" href={homeHref} aria-label="TerrierHelper home">
          <span className="brand-mark" aria-hidden="true">
            TH
          </span>
          <span>
            TerrierHelper<small>{school?.name || "St. Francis College"}</small>
          </span>
        </a>
        <nav aria-label="Primary">
          <a href={website} target="_blank" rel="noreferrer">
            College website ↗
          </a>
          {adminView ? (
            <a href={homeHref}>Student view</a>
          ) : (
            <a href={adminHref}>Administrator</a>
          )}
        </nav>
      </header>
      <main>
        <section className="intro">
          <div>
            <span className="eyebrow">
              {school?.location || "Brooklyn, New York"} ·{" "}
              {adminView ? "KNOWLEDGE ADMINISTRATION" : "STUDENT KNOWLEDGE HUB"}
            </span>
            <h1>
              {adminView
                ? "Good answers start with trusted sources."
                : "Your college. Your questions. A clearer path."}
            </h1>
            <p>
              {adminView
                ? "Review, publish, and maintain the documents students rely on."
                : "Find guidance in college documents, with a source you can check for every answer."}
            </p>
          </div>
          <div className="intro-stamp" aria-hidden="true">
            <span>TH</span>
            <small>
              ASK WITH
              <br />
              CONFIDENCE
            </small>
          </div>
        </section>
        {error && (
          <div className="notice error" role="alert">
            {error}
            <button onClick={() => setError("")} aria-label="Dismiss error">
              ×
            </button>
          </div>
        )}
        {!workspace && !error && (
          <div role="status" className="notice">
            Opening the knowledge hub…
          </div>
        )}
        {workspace && !workspace.generationEnabled && (
          <div role="status" className="notice">
            Answer generation is not configured yet. Published sources are still
            available to read.
          </div>
        )}
        {adminView && workspace && !admin ? (
          <section className="login-panel" aria-labelledby="admin-title">
            <span className="eyebrow">AUTHORIZED STAFF ONLY</span>
            <h2 id="admin-title">Administrator sign-in</h2>
            <p>
              Manage the shared knowledge base. Students never need an
              administrator key.
            </p>
            {!workspace.adminConfigured ? (
              <div className="notice">
                Administrator access has not been configured. The deployment
                owner must set a server-only ADMIN_ACCESS_KEY of at least 32
                characters, then redeploy.
              </div>
            ) : workspace.hostAuthentication ? (
              <p>
                Sign in through your organization’s connected application to
                continue.
              </p>
            ) : (
              <form onSubmit={login}>
                <label htmlFor="admin-key">Administrator access key</label>
                <input
                  id="admin-key"
                  type="password"
                  autoComplete="current-password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  required
                  maxLength={512}
                />
                <button className="primary-button" disabled={loggingIn || !key}>
                  {loggingIn ? "Signing in…" : "Sign in securely"}
                </button>
              </form>
            )}
            <a href={homeHref}>Back to student questions →</a>
          </section>
        ) : admin ? (
          <section
            className="admin-panel"
            aria-label="Knowledge administration"
          >
            <div className="panel-title">
              <div>
                <span className="eyebrow">COLLEGE DOCUMENT LIBRARY</span>
                <h2>
                  Manage sources{" "}
                  <span className="count">{documents.length}</span>
                </h2>
              </div>
              {workspace.hostAuthentication ? (
                <span>Signed in through your organization</span>
              ) : (
                <button
                  className="secondary-button"
                  disabled={working}
                  onClick={() =>
                    mutate(() =>
                      api(
                        "/api/admin/logout",
                        { method: "POST", body: "{}" },
                        base,
                      ),
                    )
                  }
                >
                  Sign out
                </button>
              )}
            </div>
            <div className="admin-summary">
              <span>
                <strong>{published.length}</strong> published
              </span>
              <span>
                <strong>{documents.filter((d) => !d.published).length}</strong>{" "}
                drafts & indexing
              </span>
              <p>
                Upload → check the PDF → publish. Only published, ready sources
                are visible to students.
              </p>
            </div>
            <label className="upload-box">
              <span className="upload-symbol" aria-hidden="true">
                ↑
              </span>
              <strong>
                {working ? "Saving…" : "Upload college documents"}
              </strong>
              <span>
                Text-based PDF · up to {workspace?.maxUploadMB} MB each · 300
                pages
              </span>
              <input
                type="file"
                aria-label="Upload PDF documents"
                accept="application/pdf,.pdf"
                multiple
                disabled={working}
                onChange={upload}
              />
            </label>
            <p className="privacy-note">
              Publish only documents intended for public student access.
              Publishing makes the PDF and its indexed content available to all
              visitors.
            </p>
            {documents.length === 0 ? (
              <div className="empty-library">
                <h3>No college documents yet</h3>
                <p>
                  Start with a current handbook, academic calendar, or
                  student-services guide.
                </p>
              </div>
            ) : (
              <div className="admin-documents">
                {documents.map((doc) => (
                  <article className="document-card" key={doc.id}>
                    <div className="document-top">
                      <span className="pdf-icon">PDF</span>
                      <h3>{doc.name}</h3>
                      <span
                        className={`status-tag ${doc.published ? "published" : ""}`}
                      >
                        {doc.published
                          ? "Published"
                          : doc.status === "ready"
                            ? "Draft"
                            : doc.status}
                      </span>
                    </div>
                    <p className="document-status">
                      {doc.pages} pages · {doc.chunks} passages ·{" "}
                      {doc.semantic ? "hybrid" : "keyword"}
                    </p>
                    <small className="document-version">
                      Version {doc.version} · added{" "}
                      {new Date(doc.createdAt).toLocaleDateString()}
                    </small>
                    {(doc.error || doc.warning) && (
                      <p className="document-warning">
                        {doc.error || doc.warning}
                      </p>
                    )}
                    <div className="document-actions">
                      <a
                        href={`${base}/documents/${doc.id}/file`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Review PDF ↗
                      </a>
                      <button
                        className="primary-button"
                        disabled={working || doc.status !== "ready"}
                        onClick={() =>
                          mutate(() =>
                            api(
                              `/api/documents/${doc.id}/publication`,
                              {
                                method: "POST",
                                body: JSON.stringify({
                                  published: !doc.published,
                                }),
                              },
                              base,
                            ),
                          )
                        }
                      >
                        {doc.published ? "Withdraw" : "Publish"} {doc.name}
                      </button>
                      {(doc.status === "failed" || doc.status === "ready") && (
                        <button
                          className="secondary-button"
                          disabled={working}
                          onClick={() =>
                            mutate(() =>
                              api(
                                `/api/documents/${doc.id}/reindex`,
                                { method: "POST", body: "{}" },
                                base,
                              ),
                            )
                          }
                        >
                          Reindex {doc.name}
                        </button>
                      )}
                      <button
                        className="danger-button"
                        disabled={working}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Permanently delete ${doc.name} and its search index?`,
                            )
                          )
                            void mutate(() =>
                              api(
                                `/api/documents/${doc.id}`,
                                { method: "DELETE", body: "{}" },
                                base,
                              ),
                            );
                        }}
                      >
                        Delete {doc.name}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : (
          <div className="workspace-grid">
            <ChatWindow
              messages={messages}
              busy={busy}
              ready={!!workspace?.generationEnabled && published.length > 0}
              progress={progress}
              onSend={send}
              onCancel={() => abort.current?.abort()}
              apiBaseUrl={base}
            />
            <aside
              className="library-panel"
              aria-label="Published college sources"
            >
              <span className="eyebrow">THE KNOWLEDGE BEHIND THE ANSWERS</span>
              <h2>
                Published sources{" "}
                <span className="count">{published.length}</span>
              </h2>
              {published.length === 0 ? (
                <div className="empty-library">
                  <h3>The library is getting ready.</h3>
                  <p>
                    An administrator needs to publish college documents before
                    questions can be answered.
                  </p>
                  <button
                    className="secondary-button"
                    onClick={() => reload().catch((e) => setError(e.message))}
                  >
                    Refresh sources
                  </button>
                </div>
              ) : (
                <ul className="source-list">
                  {published.map((doc) => (
                    <li key={doc.id}>
                      <span className="pdf-icon">PDF</span>
                      <div>
                        <a
                          href={`${base}/documents/${doc.id}/file`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {doc.name} ↗
                        </a>
                        <small>
                          {doc.pages} pages ·{" "}
                          {new Date(doc.createdAt).toLocaleDateString()}
                        </small>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="library-footnote">
                <h3>Know where your answer comes from.</h3>
                <p>
                  Open the citation to check the exact passage and PDF page. If
                  a source does not support an answer, TerrierHelper will say
                  so.
                </p>
                <p>
                  Questions and relevant source passages are sent to Google for
                  answer generation. Avoid including personal or sensitive
                  information.
                </p>
              </div>
            </aside>
          </div>
        )}
        <footer>
          <span>
            TerrierHelper · Independent project for the{" "}
            {school?.name || "St. Francis College"} community. Not an official
            college service.
          </span>
          {!adminView && (
            <button
              disabled={busy || !messages.length}
              onClick={() => setMessages([])}
            >
              Clear conversation
            </button>
          )}
        </footer>
      </main>
    </div>
  );
}
