# TerrierHelper 🐾

An AI-powered student assistant for **St. Francis College**, built with React, Express, and Google Gemini. Upload official SFC documents (handbooks, syllabi, campus maps) and ask questions about them in natural language.

![TerrierHelper UI](https://img.shields.io/badge/React-19-blue?logo=react) ![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript) ![Gemini](https://img.shields.io/badge/Gemini-2.0%20Flash-orange?logo=google)

---

## Features

-  **Multi-document ingestion** — upload multiple PDFs at once (handbooks, syllabi, etc.)
-  **Streaming chat** — responses stream token-by-token for a snappy feel
-  **API key stays server-side** — the Gemini key is never sent to the browser
-  **Session-based document store** — PDFs are uploaded once, not re-sent on every message
-  **Markdown rendering** — bullet points, numbered lists, and bold text from AI responses

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Tailwind CSS |
| Backend | Express 5, Node.js |
| AI | Google Gemini 2.0 Flash (`@google/genai`) |
| Build | Vite 6 |

## Getting Started

### Prerequisites

- Node.js 18+
- A [Google Gemini API key](https://aistudio.google.com/app/apikey)

### Installation

```bash
git clone https://github.com/saipavantejak/terrierhelper.git
cd terrierhelper
npm install
```

### Configuration

Create a `.env` file in the project root:

```env
API_KEY=your_gemini_api_key_here
```

> **Note:** The API key is read exclusively by the Express server. It is never exposed to the client.

### Running

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## How It Works

1. **Upload** — PDFs are base64-encoded in the browser and sent once to `POST /api/upload-docs`, which stores them server-side and returns a `sessionId`.
2. **Chat** — Each message sends only the `sessionId` + question to `POST /api/chat`. The server retrieves the documents, builds the Gemini prompt, and streams the response back using chunked transfer encoding.
3. **Cleanup** — Sessions automatically expire after 1 hour.

## Project Structure

```
terrierhelper/
├── server.ts                  # Express server, Gemini API calls, session store
├── App.tsx                    # Root component, state management
├── components/
│   ├── ChatWindow.tsx         # Chat UI, markdown renderer, streaming display
│   └── ChatBubble.tsx         # Floating action button
├── services/
│   └── geminiService.ts       # Fetch wrappers for /api/upload-docs and /api/chat
├── types.ts                   # Shared TypeScript types
├── constants.ts               # Brand colors, shared constants
└── vite.config.ts             # Vite build config
```

## Refactoring Notes

This project was refactored from an earlier version to address several issues:

- **API key exposure** — moved from client-side `vite.config.ts` define to server-only environment variable
- **Redundant data transfer** — replaced per-message base64 document payloads with a server-side session store
- **XSS surface** — added HTML sanitization on AI-generated content before `dangerouslySetInnerHTML`
- **Streaming UX** — fixed typing indicator to disappear as soon as the first token arrives
- **Model name** — corrected invalid `gemini-3-flash-preview` to `gemini-2.0-flash`
