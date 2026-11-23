# DocDrop

Upload a document (PDF, DOCX, TXT, MD) and get an AI-written summary.
A deliberately small React + Express project (TypeScript on both sides, Tailwind CSS for styling) for learning how LLM apps work, built to grow into RAG and "chat with your documents".

## Run it

You need Node 22+ and at least one free LLM provider:

| Provider | Cost | Setup |
|---|---|---|
| **Groq** (default model) | Free tier | Get a key at https://console.groq.com/keys |
| **Google Gemini** (optional, long documents) | Free tier | Get a key at https://aistudio.google.com/apikey |
| **Ollama** | Free, runs on your PC | Install https://ollama.com, then `ollama pull llama3.2` |

**Two models, on purpose.** Groq is very fast, but its free tier allows only ~8k tokens per minute, so a long document (split into many chunks) spends most of its time waiting out rate limits. Gemini has a huge context window, so it reads a long document in **one** call. The server picks automatically ([summarize.ts](server/src/summarize.ts)):

- fits in one Groq request (`CHUNK_SIZE`): **Groq**
- longer, and `LARGE_LLM_*` is set: **Gemini**, one call
- otherwise, or if Gemini fails: **Groq, chunk by chunk** (map-reduce)

```bash
# 1. Backend
cd server
npm install
cp .env.example .env      # then edit .env: paste your key / pick your provider
npm run models            # optional: lists model names your provider offers (add "-- large" for the long-document provider)
npm run dev               # http://localhost:3001 (tsx runs the .ts files directly and restarts on change)

# 2. Frontend (second terminal)
cd client
npm install
npm run dev               # open http://localhost:5173
```

Other scripts (both folders): `npm run typecheck` checks types without running anything; `npm run build` produces the production build (server: `dist/`, run with `npm start`).

> Free tiers have rate limits, and some (e.g. Gemini's free tier) may use your inputs to improve their models. Don't upload confidential documents unless you use Ollama.

## How it works

```
Browser (React)                     Express server                          LLM provider
───────────────                     ──────────────                          ────────────
pick file ──JSON { fileName, base64 } POST /api/summarize──▶ decode to bytes in memory
                                     │
                                     ▼  extract.ts   PDF/DOCX ─▶ plain text
                                     ▼  chunk.ts     text ─▶ chunks of ~12k chars
                                     ▼  summarize.ts prompts ──HTTP POST /chat/completions──▶ model
                                     ◀──────────────────────────────────── summary text
◀──────────── JSON { summary, stats }
```

| File | What to learn there |
|---|---|
| [server/src/llm.ts](server/src/llm.ts) | The **entire** LLM integration: one `fetch` call. Messages, roles, model, temperature, token usage. |
| [server/src/extract.ts](server/src/extract.ts) | LLMs read text, not files. Every format needs a parser (`unpdf`, `mammoth`). |
| [server/src/chunk.ts](server/src/chunk.ts) | Context windows are finite, so long text gets split, with overlap. |
| [server/src/summarize.ts](server/src/summarize.ts) | Prompting, plus the **map-reduce** pattern for documents bigger than one call. |
| [server/src/index.ts](server/src/index.ts) | The Express routes that wire the pipeline together. |
| [server/src/types.ts](server/src/types.ts) | The API's response shapes (copied to `client/src/types.ts`; keep them in sync). |
| [client/src/api.ts](client/src/api.ts) | Calling the backend: the file is sent as base64 inside JSON (see the comment there for why). |
| [client/src/App.tsx](client/src/App.tsx) | Page layout and request state (a TypeScript discriminated union). |
| [client/src/components/](client/src/components/) | `Dropzone` (file picking) and `SummaryCard` (renders the Markdown summary). |
| [client/vite.config.ts](client/vite.config.ts) | Dev proxy: `/api` goes to Express, so you need no CORS setup. |

## Key concepts

- **Token**: the unit LLMs read and bill by. Roughly 4 characters of English. The server logs `usage` on every call; watch it.
- **Context window**: the maximum number of tokens a model can see at once (prompt + answer). That's why we chunk.
- **Messages and roles**: `system` sets behaviour ("you are a summarizer…"), `user` is the request, `assistant` is the model's earlier replies. A chat is just this array growing over time.
- **Temperature**: randomness. Low (0–0.3) gives factual and consistent output; high gives creative output.
- **OpenAI-compatible API**: most providers accept the same `/chat/completions` request, so switching provider is a config change (see `.env.example`).
- **Map-reduce summarization**: summarize each chunk, then summarize the summaries. Simple and robust, but costs one call per chunk.
- **Stateless**: the model remembers nothing between calls. Every request must include everything it needs.

## Experiments to try

1. Change `SYSTEM_PROMPT` / `FINAL_INSTRUCTIONS` in `summarize.ts` (e.g. "summarize for a 10-year-old", "output JSON").
2. Set `CHUNK_SIZE=2000` in `.env` and watch map-reduce kick in (server logs show each chunk).
3. Switch providers and compare quality and speed (the stats line shows the model and time).
4. Change `temperature` in `llm.ts` to 1.2 and summarize the same file twice.
5. Add `stream: true` and stream the summary to the browser token by token (Server-Sent Events).

## Roadmap to RAG + chat

RAG (Retrieval-Augmented Generation) = instead of sending the *whole* document, find only the chunks relevant to a question and send those.

1. **Store documents.** Keep the extracted text and chunks after upload (start with a JSON file or SQLite).
2. **Embeddings.** Turn each chunk into a vector (a list of numbers capturing meaning) via an embeddings endpoint. Gemini and Ollama (`nomic-embed-text`) both offer free ones. Same pattern as `llm.ts`: `POST /embeddings`.
3. **Vector search.** Embed the user's question and find the chunks with the highest cosine similarity. Start with a plain in-memory array and a loop. Later use a vector DB (sqlite-vec, pgvector, Chroma, LanceDB).
4. **Answer.** Prompt: "Answer using only these excerpts: …". Add the question and return the answer, ideally citing which chunks it used.
5. **Chat.** Keep the message history on the client and send it with every question (the model is stateless).
6. **Improve.** Better chunking (by headings/sentences), more docs per user, reranking, evaluation.

`chunk.ts` and `llm.ts` are already the building blocks for steps 2–4.

## Limitations (on purpose)

- Old `.doc` files and scanned PDFs (images) are not supported. Those would need conversion or OCR.
- Upload limit is 3 MB: files are sent base64-encoded (~4/3 bigger) and Vercel caps request bodies at 4.5 MB. Raw binary uploads over ~1 MB are rejected by Vercel Services with 503, which is why we use base64. Nothing is persisted.
- No auth, no streaming, no tests: kept minimal so every line is easy to read.
