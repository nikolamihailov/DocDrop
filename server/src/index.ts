import express, { type ErrorRequestHandler, type Response } from 'express';
import { answerQuestion, cleanHistory, rewriteQuestion } from './answer.js';
import { extractTextFromFile, UserError } from './extract.js';
import { summarizeDocument } from './summarize.js';
import { getProvider } from './llm.js';
import { buildIndex, embedQuery, ragEnabled } from './rag.js';
import type {
  AskEvent,
  AskRequest,
  EmbedQueryRequest,
  EmbedQueryResponse,
  ErrorResponse,
  HealthResponse,
  SummarizeEvent,
  SummarizeRequest,
  SummarizeResponse,
} from './types.js';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

// Max size of the original file. The client sends it base64-encoded, which is ~4/3
// bigger, and Vercel caps request bodies at 4.5 MB: 3 MB * 4/3 = 4 MB fits.
const MAX_FILE_BYTES = 3 * 1024 * 1024;

// Uploads arrive as JSON { fileName, data } with the file base64-encoded, not as a
// multipart/form-data binary upload. Why: on Vercel Services, raw binary request
// bodies over ~1 MB are rejected with 503 SERVICE_UNAVAILABLE before reaching this
// code, while text bodies up to the 4.5 MB limit get through. Base64 is plain text.
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_req, res) => {
  const body: HealthResponse = {
    ok: true,
    model: getProvider('default')?.model ?? null,
    largeModel: getProvider('large')?.model ?? null,
  };
  res.json(body);
});

// RAG step 2: turn a question into a vector. The SEARCH itself happens in the browser,
// which holds the document's passage vectors (see client/src/rag.ts).
// Step 4: with chat history, a follow-up is first rewritten into a standalone question.
app.post('/api/embed-query', async (req, res) => {
  const { text, model, history } = (req.body ?? {}) as Partial<EmbedQueryRequest>;
  if (typeof text !== 'string' || !text.trim() || typeof model !== 'string') {
    throw new UserError('Expected JSON { text, model, history? }');
  }
  if (text.length > 2000) throw new UserError('Question is too long (max 2,000 characters).');

  const searchQuery = await rewriteQuestion(text.trim(), cleanHistory(history));
  if (searchQuery !== text.trim()) console.log(`[rag] rewrote "${text.trim()}" -> "${searchQuery}"`);
  const body: EmbedQueryResponse = { vector: await embedQuery(searchQuery, model), searchQuery };
  res.json(body);
});

/**
 * Start an NDJSON stream response (one JSON object per line) and return a function that
 * sends one event. After this, the status is 200: errors must be sent as events too.
 */
function startNdjson<Event>(res: Response): (event: Event) => void {
  res.status(200).set({
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform', // don't let proxies buffer or compress it
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  return (event) => res.write(JSON.stringify(event) + '\n');
}

// RAG step 3: answer a question from the passages the browser's search picked.
// Streams the answer as it's generated: { type: 'token' } events, then 'done' or 'error'.
// Big enough for a whole small document (client sends all passages up to ~12,000 chars)
const MAX_PASSAGES = 20;
const MAX_PASSAGE_CHARS = 20_000; // all passages together: keeps the prompt small and cheap

app.post('/api/ask', async (req, res) => {
  const { question, passages, history } = (req.body ?? {}) as Partial<AskRequest>;
  if (typeof question !== 'string' || !question.trim() || !Array.isArray(passages) || passages.length === 0) {
    throw new UserError('Expected JSON { question, passages: [{ chunk, text }] }');
  }
  if (question.length > 2000) throw new UserError('Question is too long (max 2,000 characters).');
  const valid = passages.every((p) => typeof p?.text === 'string' && Number.isInteger(p?.chunk));
  const totalChars = passages.reduce((sum, p) => sum + (p?.text?.length ?? 0), 0);
  if (!valid || passages.length > MAX_PASSAGES || totalChars > MAX_PASSAGE_CHARS) {
    throw new UserError(`Expected up to ${MAX_PASSAGES} passages of text (max ${MAX_PASSAGE_CHARS} characters in total).`);
  }

  const send = startNdjson<AskEvent>(res);
  try {
    const model = await answerQuestion(question.trim(), passages, cleanHistory(history), (text) =>
      send({ type: 'token', text }),
    );
    send({ type: 'done', model });
  } catch (err) {
    console.error('[ask]', err);
    send({ type: 'error', error: err instanceof Error ? err.message : 'Unknown error' });
  } finally {
    res.end();
  }
});

// The whole pipeline: upload -> extract text -> chunk -> LLM -> summary.
//
// Instead of one JSON answer at the end, this route STREAMS its progress: it writes
// one JSON object per line (NDJSON) as it goes, and the browser reads them as they
// arrive. That's how the page can show "Summarizing part 3 of 5…" live.
// (Server-Sent Events is a similar format, but the browser's EventSource only
// supports GET requests, and we need to POST the file.)
app.post('/api/summarize', async (req, res) => {
  // Problems with the request itself are thrown BEFORE streaming starts, so they
  // still become normal JSON errors with a 4xx status (Express 5 forwards errors
  // thrown in async handlers to the error handler below).
  const { fileName, data } = (req.body ?? {}) as Partial<SummarizeRequest>;
  if (typeof fileName !== 'string' || typeof data !== 'string' || !fileName || !data) {
    throw new UserError('Expected JSON { fileName, data } with the file base64-encoded in "data"');
  }
  const buffer = Buffer.from(data, 'base64');
  if (buffer.length > MAX_FILE_BYTES) throw new UserError('File is too large. The maximum size is 3 MB.');

  // From here on, the status is 200 and everything (including errors) is an event.
  const send = startNdjson<SummarizeEvent>(res);

  try {
    const started = Date.now();
    send({ type: 'progress', stage: 'extracting' });
    const text = await extractTextFromFile({ originalname: fileName, buffer });
    // Summary and Q&A index are independent, so build them AT THE SAME TIME (Promise.all).
    // The index must never break the summary: its errors become `indexError` instead.
    const [{ summary, chunks, model, targetWords }, { index, indexError }] = await Promise.all([
      summarizeDocument(text, (progress) => send({ type: 'progress', ...progress })),
      ragEnabled()
        ? buildIndex(text).then(
            (index) => ({ index, indexError: null }),
            (err: unknown) => {
              console.warn('[rag] indexing failed:', err);
              return { index: null, indexError: err instanceof Error ? err.message : 'Indexing failed' };
            },
          )
        : { index: null, indexError: 'Q&A is not configured on the server (EMBEDDING_MODEL is not set).' },
    ]);

    const result: SummarizeResponse = {
      fileName,
      summary,
      index,
      indexError,
      stats: {
        characters: text.length,
        approxTokens: Math.round(text.length / 4),
        chunks,
        model,
        targetWords,
        ms: Date.now() - started,
      },
    };
    send({ type: 'result', result });
  } catch (err) {
    if (!(err instanceof UserError)) console.error(err);
    send({ type: 'error', error: err instanceof Error ? err.message : 'Unknown error' });
  } finally {
    res.end();
  }
});

// Central error handler: user mistakes -> 4xx, everything else -> 500.
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  // express.json() errors carry their own status: 413 (body too large) or 400 (bad JSON).
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'File is too large. The maximum size is 3 MB.' } satisfies ErrorResponse);
    return;
  }
  const isUserError = err instanceof UserError || err?.type === 'entity.parse.failed';
  if (!isUserError) console.error(err);
  const body: ErrorResponse = { error: err instanceof Error ? err.message : 'Unknown error' };
  res.status(isUserError ? 400 : 500).json(body);
};
app.use(errorHandler);

// Locally we start a normal long-running server. On Vercel (which sets VERCEL=1)
// the app runs as a serverless function: Vercel imports the exported app and
// calls it once per request, so we must not listen on a port ourselves.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`DocDrop server on http://localhost:${PORT} (model: ${process.env.LLM_MODEL ?? 'NOT SET'})`);
  });
}

export default app;
