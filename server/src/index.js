import express from 'express';
import multer from 'multer';
import { extractTextFromFile, UserError } from './extract.js';
import { summarizeDocument } from './summarize.js';
import { currentModel } from './llm.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Keep uploads in memory: we only need the bytes long enough to extract text.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, model: process.env.LLM_MODEL ?? null });
});

// The whole pipeline: upload -> extract text -> chunk -> LLM -> summary
app.post('/api/summarize', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new UserError('No file uploaded (expected form field "file")');

    const started = Date.now();
    const text = await extractTextFromFile(req.file);
    const { summary, chunks } = await summarizeDocument(text);

    res.json({
      fileName: req.file.originalname,
      summary,
      stats: {
        characters: text.length,
        approxTokens: Math.round(text.length / 4),
        chunks,
        model: currentModel(),
        ms: Date.now() - started,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Central error handler: user mistakes -> 400, everything else -> 500.
app.use((err, req, res, next) => {
  const isUserError = err instanceof UserError || err instanceof multer.MulterError;
  if (!isUserError) console.error(err);
  res.status(isUserError ? 400 : 500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`DocDrop server on http://localhost:${PORT} (model: ${process.env.LLM_MODEL ?? 'NOT SET'})`);
});
