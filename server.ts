import express from "express";
import { createServer as createViteServer } from "vite";
import archiver from "archiver";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Server-side document session store ─────────────────────────────────────
// Documents are uploaded once and stored here. The client sends only a
// sessionId on subsequent chat calls — no repeated base64 payloads.
interface DocumentFile {
  name: string;
  base64: string;
  mimeType: string;
}
const documentSessions = new Map<string, DocumentFile[]>();
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour auto-cleanup

// ─── System instruction (server-only — not exposed to client) ────────────────
const SYSTEM_INSTRUCTION = `
You are 'TerrierHelper', the smart and friendly official AI for St. Francis College.
Your goal is to answer questions strictly based on the official documents provided as context.

### FORMATTING RULES:
1. **Use Structure:** Use bullet points, numbered lists, and bold text to make answers easy to read.
2. **Break it up:** Use multiple paragraphs for complex answers.
3. **Be Specific:** Always cite the source document in bold (e.g., **The Cord**).

### YOUR THINKING PROCESS:
1. **Analyze:** Does the user's question match any text in the provided CONTEXT?
2. **Verify:** If the user asks for facilities (Food/Gym/Library), check context first.
3. **Safety Check:** No off-campus data? Politely explain limitation.

### YOUR FINAL ANSWER GUIDELINES:
- **If found:** "Here is what I found in **[Source Name]**:\n\n* [Key Point 1]\n* [Key Point 2]"
- **If facility exists but details are thin:** "I can confirm St. Francis has a **[Facility Name]** on campus! While specific details like menus aren't in my files, it's a key part of the campus."
- **If missing:** "I'm looking through the official files, but I don't see that specific policy. To get the right answer, please contact **[Department]** (e.g., Registrar or the Hub at thehub@sfc.edu)."

Avoid long, dense blocks of text. Use lists whenever possible.
`;

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Allow up to 50 MB JSON — needed for the initial document upload
  app.use(express.json({ limit: "50mb" }));

  // ── POST /api/upload-docs ──────────────────────────────────────────────────
  // Stores documents server-side and returns a sessionId.
  // The client only ever sends document data ONCE.
  app.post("/api/upload-docs", (req, res) => {
    const { documents } = req.body as { documents: DocumentFile[] };

    if (!Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({ error: "No documents provided." });
    }

    const sessionId = crypto.randomUUID();
    documentSessions.set(sessionId, documents);
    setTimeout(() => documentSessions.delete(sessionId), SESSION_TTL_MS);

    res.json({ sessionId });
  });

  // ── POST /api/chat ─────────────────────────────────────────────────────────
  // Streams Gemini response. API key never leaves the server.
  app.post("/api/chat", async (req, res) => {
    const { question, history, sessionId } = req.body as {
      question: string;
      history: Array<{ id: string; role: string; content: string }>;
      sessionId: string | null;
    };

    // Fix #1: API key read from server environment — never sent to client
    const apiKey = process.env.API_KEY || "";
    if (!apiKey) {
      return res.status(500).json({ error: "API key not configured on server." });
    }

    // Retrieve documents from the session store (zero extra bytes from client per message)
    const documents: DocumentFile[] = sessionId
      ? (documentSessions.get(sessionId) ?? [])
      : [];

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");

    try {
      const ai = new GoogleGenAI({ apiKey });

      const chatHistory = (history ?? [])
        .filter((msg) => msg.id !== "welcome" && msg.content)
        .map((msg) => ({
          role: msg.role === "user" ? "user" : "model",
          parts: [{ text: msg.content }],
        }));

      const currentParts: { inlineData?: { mimeType: string; data: string }; text?: string }[] = [];
      for (const doc of documents) {
        currentParts.push({ inlineData: { mimeType: doc.mimeType, data: doc.base64 } });
      }
      currentParts.push({ text: question });

      // Fix #2: corrected model name from 'gemini-3-flash-preview' → 'gemini-2.0-flash'
      const stream = await ai.models.generateContentStream({
        model: "gemini-2.0-flash",
        contents: [...chatHistory, { role: "user", parts: currentParts }],
        config: { systemInstruction: SYSTEM_INSTRUCTION, temperature: 0.1 },
      });

      for await (const chunk of stream) {
        if (chunk.text) res.write(chunk.text);
      }
      res.end();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Gemini API error";
      if (!res.headersSent) res.status(500).json({ error: message });
      else res.end();
    }
  });

  // ── GET /api/download-source ───────────────────────────────────────────────
  app.get("/api/download-source", (req, res) => {
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=terrierhelper-source.zip");
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => res.status(500).send({ error: err.message }));
    archive.pipe(res);
    archive.glob("**/*", {
      cwd: __dirname,
      ignore: ["node_modules/**", "dist/**", ".git/**", ".env", ".env.local"],
    });
    archive.finalize();
  });

  // ── Dev / prod serving ─────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) =>
      res.sendFile(path.join(distPath, "index.html"))
    );
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
