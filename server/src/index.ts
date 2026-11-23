import express, { type ErrorRequestHandler } from 'express';
import { extractTextFromFile, UserError } from './extract.js';
import { summarizeDocument } from './summarize.js';
import { currentModel } from './llm.js';
import type {
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
  const body: HealthResponse = { ok: true, model: process.env.LLM_MODEL ?? null };
  res.json(body);
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
  res.status(200).set({
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform', // don't let proxies buffer or compress it
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  const send = (event: SummarizeEvent) => res.write(JSON.stringify(event) + '\n');

  try {
    const started = Date.now();
    send({ type: 'progress', stage: 'extracting' });
    const text = await extractTextFromFile({ originalname: fileName, buffer });
    const { summary, chunks } = await summarizeDocument(text, (progress) => send({ type: 'progress', ...progress }));

    const result: SummarizeResponse = {
      fileName,
      summary,
      stats: {
        characters: text.length,
        approxTokens: Math.round(text.length / 4),
        chunks,
        model: currentModel(),
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
