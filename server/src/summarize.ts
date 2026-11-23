// Step 3: ask the LLM for a summary.
//
// Which model? (see llm.ts)
// - The document fits in one call of the default model (Groq): use it, it's fastest.
// - It doesn't, and a "large" model (Gemini) is configured: send the whole document
//   to Gemini in one call; its context window is huge.
// - Otherwise, or if Gemini fails: "map-reduce" with the default model: summarize
//   each chunk (map), then summarize those summaries into one (reduce). This works for
//   any length, but costs one call per chunk, which is slow on free-tier rate limits.
import { chat, defaultProvider, getProvider, type ChatMessage, type LlmProvider } from './llm.js';
import { chunkText } from './chunk.js';
import type { ProgressStage } from './types.js';

const SYSTEM_PROMPT =
  'You are an assistant that summarizes documents. ' +
  'Be accurate and only use information present in the provided text. ' +
  'Write in the same language as the document.';

// --- How long should the summary be? -------------------------------------------
// It scales with the document, but sub-linearly: 4 × √(document words), clamped.
//   40 words → 25 (min) · 500 → ~90 · 2,500 → ~200 · 10,000+ → 400 (max)
// A square root grows fast for short documents and slowly for long ones, which
// matches how much a reader wants: a 50-page report doesn't need a 50× longer summary.
const MIN_SUMMARY_WORDS = 25;
const MAX_SUMMARY_WORDS = 400;

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function targetSummaryWords(documentWords: number): number {
  const target = Math.round(4 * Math.sqrt(documentWords));
  return Math.min(MAX_SUMMARY_WORDS, Math.max(MIN_SUMMARY_WORDS, target));
}

// --- What should it look like? ---------------------------------------------------
// Models follow concrete numbers ("about 90 words", "up to 3 bullets") much better
// than vague ones ("be brief"). Each section has its own job, so nothing is repeated.
function finalInstructions(target: number): string {
  // Very short documents: a heading structure would be longer than the content.
  if (target < 60) {
    return `Write a summary of about ${target} words as a single short paragraph. No headings, no bullet points.`;
  }

  const maxPoints = Math.min(8, Math.max(2, Math.round(target / 45)));
  const overviewSentences = target < 150 ? '1–2' : '2–4';
  return `Write a summary in Markdown of about ${target} words (between ${Math.round(target * 0.8)} and ${Math.round(target * 1.2)}).

Use this structure:

## Overview
${overviewSentences} sentences: what the document is, its purpose, and its main conclusion or outcome.

## Key points
Up to ${maxPoints} bullet points. Each bullet is one distinct idea, finding, decision or condition, with its important specifics (names, dates, amounts) written inline. Put the single most important phrase of each bullet in **bold**.

## Action items
ONLY if the document asks the reader to do something or sets deadlines: list those actions with their dates. If it doesn't, leave this section out completely.

Rules:
- Every fact appears exactly once in the whole summary. Bullets must not repeat the Overview, and Action items must not repeat Key points.
- Prioritize: leave out minor details rather than going over the word budget.
- No introduction or closing remarks, just the summary.`;
}

export interface SummaryResult {
  summary: string;
  chunks: number;
  /** The model that wrote the summary. */
  model: string;
  /** The word budget the model was given. */
  targetWords: number;
}

type OnProgress = (progress: ProgressStage) => void;

export async function summarizeDocument(text: string, onProgress: OnProgress = () => {}): Promise<SummaryResult> {
  const primary = defaultProvider();
  const chunkSize = Number(process.env.CHUNK_SIZE) || 12000;
  const large = getProvider('large');

  // The budget comes from the WHOLE document, also when it's summarized in chunks.
  const targetWords = targetSummaryWords(countWords(text));
  const instructions = finalInstructions(targetWords);
  console.log(`[summarize] ${countWords(text)} words -> target ~${targetWords} words`);

  // Long document + a large-context model available: try it first, in a single call.
  if (text.length > chunkSize && large) {
    const largeChunkSize = Number(process.env.LARGE_CHUNK_SIZE) || 400_000; // ~100k tokens
    try {
      // Few retries: if Gemini is out of quota, falling back beats waiting.
      return await summarizeWith(large, text, largeChunkSize, instructions, targetWords, onProgress, 2);
    } catch (err) {
      console.warn(`[summarize] ${large.model} failed, falling back to ${primary.model}:`, err);
      onProgress({ stage: 'fallback', model: primary.model });
    }
  }

  return summarizeWith(primary, text, chunkSize, instructions, targetWords, onProgress, 5);
}

async function summarizeWith(
  provider: LlmProvider,
  text: string,
  chunkSize: number,
  instructions: string,
  targetWords: number,
  onProgress: OnProgress,
  maxRetries: number,
): Promise<SummaryResult> {
  const chunks = chunkText(text, { chunkSize });
  const result = (summary: string): SummaryResult => ({
    summary,
    chunks: chunks.length,
    model: provider.model,
    targetWords,
  });

  // Every LLM call reports rate-limit waits, so the user sees why it's slow.
  const ask = (messages: ChatMessage[]) =>
    chat(messages, {
      provider,
      maxRetries,
      onRateLimit: (ms) => onProgress({ stage: 'waiting', seconds: Math.ceil(ms / 1000) }),
    });

  if (chunks.length === 1) {
    onProgress({ stage: 'summarizing', part: 1, total: 1, model: provider.model });
    const summary = await ask([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `${instructions}\n\n<document>\n${chunks[0]}\n</document>` },
    ]);
    return result(summary);
  }

  // MAP: one call per chunk. Sequential (not Promise.all) to stay under free-tier rate limits.
  const partials: string[] = [];
  for (const [i, chunk] of chunks.entries()) {
    console.log(`[summarize] ${provider.model} chunk ${i + 1}/${chunks.length}`);
    onProgress({ stage: 'summarizing', part: i + 1, total: chunks.length, model: provider.model });
    partials.push(
      await ask([
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content:
            `This is part ${i + 1} of ${chunks.length} of a longer document. ` +
            `Summarize this part in a few concise bullet points.\n\n<part>\n${chunk}\n</part>`,
        },
      ]),
    );
  }

  onProgress({ stage: 'combining' });

  // REDUCE: combine the partial summaries into one.
  const combined = partials
    .map((p, i) => `<part_summary index="${i + 1}">\n${p}\n</part_summary>`)
    .join('\n\n');

  const summary = await ask([
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        'Below are summaries of consecutive parts of one document. ' +
        `Combine them into a single summary of the whole document.\n\n${instructions}\n\n${combined}`,
    },
  ]);

  return result(summary);
}
