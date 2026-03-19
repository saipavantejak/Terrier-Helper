
import { Message, DocumentFile } from "../types";

// ─── Upload documents to the server session store ───────────────────────────
// Documents are sent once; the server returns a sessionId that is used for
// all subsequent chat calls — no repeated base64 payloads. (Fix #4)
export const uploadDocuments = async (documents: DocumentFile[]): Promise<string> => {
  const response = await fetch("/api/upload-docs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documents }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Failed to upload documents.");
  }

  const data = await response.json();
  return data.sessionId as string;
};

// ─── Streaming chat via server proxy ────────────────────────────────────────
// The API key is never touched here — it lives only in the server process.
// (Fix #1)
export const askGeminiStream = async function* (
  question: string,
  history: Message[],
  sessionId: string | null
): AsyncGenerator<string> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, history, sessionId }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Chat request failed.");
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (text) yield text;
  }
};
