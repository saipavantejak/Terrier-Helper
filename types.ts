export interface KnowledgeDocument {
  id: string;
  name: string;
  version: string;
  createdAt: string;
  status: "queued" | "processing" | "ready" | "failed";
  pages: number;
  chunks: number;
  error: string | null;
  warning: string | null;
  semantic: boolean;
  published?: boolean;
}
export interface Citation {
  id: string;
  documentId: string;
  name: string;
  version: string;
  page: number;
  quote: string;
}
export interface Answer {
  status: "answered" | "insufficient_evidence" | "conversation";
  conversation?: string;
  statements: Array<{ text: string; citationIds: string[] }>;
  citations: Citation[];
  retrievalMode: "hybrid" | "keyword";
  requestId: string;
}
export interface Message {
  id: string;
  role: "user" | "bot";
  content: string;
  answer?: Answer;
  error?: boolean;
}
