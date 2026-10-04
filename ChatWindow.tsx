import FeedbackButton from "./FeedbackButton";
import { domainProfiles, type DomainProfile } from "./domain";
import { useEffect, useRef, useState, useId } from "react";
import type { Message } from "./types";
export default function ChatWindow({
  messages,
  busy,
  ready,
  progress,
  onSend,
  onCancel,
  apiBaseUrl = "/api",
  college = true,
  profile = domainProfiles.college,
  responseStyle = "standard",
  onStyleChange,
}: {
  apiBaseUrl?: string;
  college?: boolean;
  profile?: DomainProfile;
  responseStyle?: import("./types").ResponseStyle;
  onStyleChange?: (style: import("./types").ResponseStyle) => void;
  messages: Message[];
  busy: boolean;
  ready: boolean;
  progress: string;
  onSend: (question: string) => void;
  onCancel: () => void;
}) {
  const questionId = useId();
  const [input, setInput] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, progress]);
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (input.trim() && !busy && ready) {
      onSend(input.trim());
      setInput("");
    }
  }
  return (
    <section className="chat-panel" aria-label="Ask your documents">
      <div className="chat-heading">
        <div>
          <span className="eyebrow">{profile.companion}</span>
          <h2>Ask. Verify. Understand.</h2>
        </div>
        <span className="grounded-badge">● Evidence first</span>
      </div>
      <div
        className="conversation"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {messages.length === 0 ? (
          <div className="empty-chat">
            <div className="chat-emblem">
              {profile.id === "college" ? (
                <>
                  T<span>h</span>
                </>
              ) : (
                "DOC"
              )}
            </div>
            <h3>A little guidance. A clearer next step.</h3>
            <p>
              Explore policies, find requirements, and check every answer
              against the original source.
            </p>
            <div className="suggestions">
              {profile.suggestions.map((q) => (
                <button key={q} disabled={!ready} onClick={() => onSend(q)}>
                  {q}
                  <span aria-hidden="true">↗</span>
                </button>
              ))}
            </div>
            <small>
              {college
                ? "Answers use sources published by the knowledge-base administrator."
                : "Upload a text-based PDF to get started."}
            </small>
          </div>
        ) : (
          messages.map((message) => (
            <article
              key={message.id}
              className={`message ${message.role}${message.error ? " error" : ""}`}
            >
              <span className="message-author">
                {message.role === "user"
                  ? "YOU"
                  : profile.assistantName.toUpperCase()}
              </span>
              {message.content ? <p>{message.content}</p> : null}
              {message.answer ? (
                <>
                  {message.answer.status === "conversation" ? (
                    <p>{message.answer.conversation}</p>
                  ) : message.answer.status === "insufficient_evidence" ? (
                    <p>
                      I couldn’t find enough information in the available
                      documents to answer that confidently, and I don’t want to
                      guess. Could you make your question a little more
                      specific?
                    </p>
                  ) : (
                    message.answer.statements.map((statement, index) => (
                      <p key={index}>
                        {statement.text}{" "}
                        <span className="citation-links">
                          {statement.citationIds.map((id) => (
                            <a
                              key={id}
                              href={`#${message.id}-${id}`}
                              aria-label={`View source ${id}`}
                            >
                              [{id}]
                            </a>
                          ))}
                        </span>
                      </p>
                    ))
                  )}
                  {message.answer.citations.length > 0 ? (
                    <div className="evidence">
                      <span className="eyebrow">SUPPORTING EVIDENCE</span>
                      {message.answer.citations.map((citation) => (
                        <details
                          key={citation.id}
                          id={`${message.id}-${citation.id}`}
                        >
                          <summary>
                            <span className="source-tag">{citation.id}</span>
                            {citation.name}
                            <span className="page-label">
                              p. {citation.page}
                            </span>
                          </summary>
                          <blockquote>{citation.quote}</blockquote>
                          <div className="source-footer">
                            <span>Version {citation.version}</span>
                            <a
                              href={`${apiBaseUrl}/documents/${citation.documentId}/file#page=${citation.page}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open PDF page ↗
                            </a>
                          </div>
                        </details>
                      ))}
                    </div>
                  ) : null}
                  {message.answer.status !== "conversation" ? (
                    <small className="answer-meta">
                      {message.answer.retrievalMode === "hybrid"
                        ? "Keyword + semantic retrieval"
                        : "Keyword retrieval"}{" "}
                      · Check sources before acting on important policies.
                    </small>
                  ) : null}
                  {message.answer.feedbackToken && (
                    <FeedbackButton
                      token={message.answer.feedbackToken}
                      base={apiBaseUrl}
                    />
                  )}
                </>
              ) : null}
            </article>
          ))
        )}
        {busy ? (
          <p className="progress" role="status">
            <span className="pulse" />
            {progress}
          </p>
        ) : null}
        <div ref={end} />
      </div>
      {onStyleChange && (
        <label className="style-choice">
          Answer style{" "}
          <select
            aria-label="Answer style"
            value={responseStyle}
            onChange={(e) =>
              onStyleChange(e.target.value as import("./types").ResponseStyle)
            }
          >
            <option value="standard">Standard</option>
            <option value="brief">Brief</option>
            <option value="plain">Simple language</option>
          </select>
        </label>
      )}
      <form className="composer" onSubmit={submit}>
        <label className="sr-only" htmlFor={questionId}>
          Ask a question
        </label>
        <textarea
          id={questionId}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={2000}
          rows={2}
          disabled={!ready || busy}
          placeholder={
            ready
              ? profile.placeholder
              : college
                ? "Waiting for published sources…"
                : "Upload and index a document to begin…"
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (input.trim() && ready && !busy) {
                onSend(input.trim());
                setInput("");
              }
            }
          }}
        />
        {busy ? (
          <button type="button" className="send-button" onClick={onCancel}>
            Stop
          </button>
        ) : (
          <button
            className="send-button"
            disabled={!input.trim() || !ready}
            type="submit"
            aria-label="Send question"
          >
            ↑
          </button>
        )}
      </form>
      <p className="composer-note">
        Answers are checked against retrieved passages. Verification can still
        make mistakes.
      </p>
    </section>
  );
}
