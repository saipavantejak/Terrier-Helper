import { useId, useState } from "react";
import { api } from "./geminiService";
export default function FeedbackButton({
  token,
  base,
}: {
  token: string;
  base: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<"helpful" | "unhelpful">("helpful");
  const [note, setNote] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  if (sent)
    return (
      <p role="status" className="feedback-note">
        Thank you. Your feedback is available for admin review.
      </p>
    );
  return (
    <div className="feedback-box">
      <button
        type="button"
        className="secondary-button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Give feedback
      </button>
      {open && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy || !consent) return;
            setBusy(true);
            setError("");
            try {
              await api(
                "/api/feedback",
                {
                  method: "POST",
                  body: JSON.stringify({ token, rating, note, consent }),
                },
                base,
              );
              setSent(true);
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Feedback could not be saved.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor={id + "-rating"}>Was this answer helpful?</label>
          <select
            id={id + "-rating"}
            value={rating}
            onChange={(e) => setRating(e.target.value as typeof rating)}
          >
            <option value="helpful">Helpful</option>
            <option value="unhelpful">Needs improvement</option>
          </select>
          <label htmlFor={id + "-note"}>What could be better? (optional)</label>
          <textarea
            id={id + "-note"}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="For example: the cited passage doesn’t answer my question."
          />
          <label className="consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />{" "}
            Share this question, recent question context, answer, citations, and
            feedback with administrators for improvement.
          </label>
          <p className="feedback-note">
            Do not include personal or sensitive information. Feedback is not a
            factual source. Unapproved feedback is retained for up to 30 days;
            approved examples remain until an administrator deletes them.
          </p>
          {error && <p role="alert">{error}</p>}
          <button className="primary-button" disabled={busy || !consent}>
            {busy ? "Saving…" : "Submit feedback"}
          </button>
        </form>
      )}
    </div>
  );
}
