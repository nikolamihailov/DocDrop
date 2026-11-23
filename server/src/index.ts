import express, { type ErrorRequestHandler } from 'express';
import multer from 'multer';
import { extractTextFromFile, UserError } from './extract.js';
import { summarizeDocument } from './summarize.js';
import { currentModel } from './llm.js';
import type { ErrorResponse, HealthResponse, SummarizeResponse } from './types.js';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

// Keep uploads in memory: we only need the bytes long enough to extract text.
// 4 MB because Vercel rejects request bodies over 4.5 MB before they reach our code.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
});

app.get('/api/health', (_req, res) => {
  const body: HealthResponse = { ok: true, model: process.env.LLM_MODEL ?? null };
  res.json(body);
});

// The whole pipeline: upload -> extract text -> chunk -> LLM -> summary.
// Express 5 forwards errors thrown in async handlers to the error handler below,
// so no try/catch is needed here.
app.post('/api/summarize', upload.single('file'), async (req, res) => {
  if (!req.file) throw new UserError('No file uploaded (expected form field "file")');

  const started = Date.now();
  const text = await extractTextFromFile(req.file);
  const { summary, chunks } = await summarizeDocument(text);

  const body: SummarizeResponse = {
    fileName: req.file.originalname,
    summary,
    stats: {
      characters: text.length,
      approxTokens: Math.round(text.length / 4),
      chunks,
      model: currentModel(),
      ms: Date.now() - started,
    },
  };
  res.json(body);
});

// Central error handler: user mistakes -> 400, everything else -> 500.
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const isUserError = err instanceof UserError || err instanceof multer.MulterError;
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
