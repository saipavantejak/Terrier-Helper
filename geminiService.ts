import type { Answer, KnowledgeDocument } from "./types";
export async function api<T>(
  url: string,
  options: RequestInit = {},
  base = "/api",
): Promise<T> {
  const response = await fetch(
    base.replace(/\/$/, "") + url.replace(/^\/api/, ""),
    {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    },
  );
  const data = await response
    .json()
    .catch(() => ({ error: "Unexpected server response." }));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data as T;
}
export async function uploadDocument(file: File, maxMB = 10, base = "/api") {
  if (
    file.size > maxMB * 1024 * 1024 ||
    !file.name.toLowerCase().endsWith(".pdf")
  )
    throw new Error(`Choose a PDF up to ${maxMB} MB.`);
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
  return api<{ id: string; documents: KnowledgeDocument[] }>(
    "/api/documents",
    {
      method: "POST",
      body: JSON.stringify({ name: file.name, base64 }),
    },
    base,
  );
}
export async function ask(
  question: string,
  documentIds: string[],
  previousQuestion: string | undefined,
  onProgress: (text: string) => void,
  signal: AbortSignal,
  base = "/api",
): Promise<Answer> {
  const response = await fetch(base.replace(/\/$/, "") + "/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, documentIds, previousQuestion }),
    signal,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Could not send question.");
  }
  if (!response.body) throw new Error("Response stream unavailable.");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    answer: Answer | undefined,
    completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = frame
          .split("\n")
          .find((line) => line.startsWith("event: "))
          ?.slice(7);
        const raw = frame
          .split("\n")
          .find((line) => line.startsWith("data: "))
          ?.slice(6);
        if (!raw) continue;
        const data = JSON.parse(raw);
        if (event === "progress") onProgress(data.message);
        if (event === "error") throw new Error(data.error);
        if (event === "answer") answer = data;
        if (event === "done") completed = true;
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
  if (!completed || !answer)
    throw new Error("The response was interrupted. Please retry.");
  return answer;
}
