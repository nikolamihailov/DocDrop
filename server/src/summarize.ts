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
// It scales with the document, but sub-linearly: 6 × √(document words), clamped.
//   40 words → 40 (min) · 500 (~1 page) → ~135 · 2,500 (~5 pages) → 300
//   10,000 → 600 · 22,500+ (~65 pages) → 900 (max)
// A square root grows fast for short documents and slowly for long ones, which
// matches how much a reader wants: a 50-page report doesn't need a 50× longer summary.
// Tune these three numbers to make summaries longer or shorter overall.
const SUMMARY_LENGTH_FACTOR = 6;
const MIN_SUMMARY_WORDS = 40;
const MAX_SUMMARY_WORDS = 900;

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function targetSummaryWords(documentWords: number): number {
  const target = Math.round(SUMMARY_LENGTH_FACTOR * Math.sqrt(documentWords));
  return Math.min(MAX_SUMMARY_WORDS, Math.max(MIN_SUMMARY_WORDS, target));
}

// --- What should it look like? ---------------------------------------------------
// Models follow concrete numbers ("about 90 words", "up to 3 bullets") much better
// than vague ones ("be brief"). Each section has its own job, so nothing is repeated.
function finalInstructions(target: number): string {
  const range = `between ${Math.round(target * 0.9)} and ${Math.round(target * 1.1)} words`;

  // Very short documents: a heading structure would be longer than the content.
  if (target < 70) {
    return `Write a summary as a single paragraph of ${range}. No headings, no bullet points.`;
  }

  const overviewSentences = target < 200 ? '2–3' : '3–5';

  // Long summaries: group the key points by the document's own sections or themes,
  // so 900 words stay easy to scan instead of becoming one endless list.
  const keyPoints =
    target >= 350
      ? `Group the key points under ### subheadings that follow the document's own main sections or themes (typically ${Math.round(target / 150)}–${Math.round(target / 100)} groups). Under each subheading, write bullet points.`
      : `Write about ${Math.max(3, Math.round(target / 35))} bullet points.`;

  return `Write a summary in Markdown of ${range}. Models tend to write too little: use the full budget, filling it with substance from the document, not with filler.

Use this structure:

## Overview
${overviewSentences} sentences: what the document is, its purpose, and its main conclusion or outcome.

## Key points
${keyPoints} Each bullet is one distinct idea, finding, example, decision or condition, with its important specifics (names, dates, numbers, definitions) written inline. Put the single most important phrase of each bullet in **bold**.

## Action items
ONLY if the document asks the reader to do something or sets deadlines: list those actions with their dates. If it doesn't, leave this section out completely.

Rules:
- Cover the whole document, from beginning to end, in proportion to how much space each part takes in it.
- Every fact appears exactly once in the whole summary. Bullets must not repeat the Overview, and Action items must not repeat Key points.
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

  // Each model with its own request size and patience. Few retries for Gemini: when it's
  // overloaded, switching to Groq beats waiting.
  const primaryAttempt = { provider: primary, chunkSize, maxRetries: 5 };
  const largeAttempt = large && {
    provider: large,
    chunkSize: Number(process.env.LARGE_CHUNK_SIZE) || 400_000, // ~100k tokens: one call
    maxRetries: 2,
  };

  // Preferred model first, the other one as a backup (in both directions: Groq also has
  // a DAILY token limit, and then Gemini can take over the short documents too).
  const isLong = text.length > chunkSize;
  const attempts = !largeAttempt ? [primaryAttempt] : isLong ? [largeAttempt, primaryAttempt] : [primaryAttempt, largeAttempt];

  for (const [i, attempt] of attempts.entries()) {
    try {
      return await summarizeWith(
        attempt.provider,
        text,
        attempt.chunkSize,
        instructions,
        targetWords,
        onProgress,
        attempt.maxRetries,
      );
    } catch (err) {
      const next = attempts[i + 1];
      if (!next) throw err;
      console.warn(`[summarize] ${attempt.provider.model} failed, falling back to ${next.provider.model}:`, err);
      onProgress({ stage: 'fallback', model: next.provider.model });
    }
  }
  throw new Error('unreachable');
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
  // Each part's notes get a share of the final budget (×2, since the final step condenses
  // them again): with "a few bullets" per part, detail was lost before the final summary.
  const partWords = Math.min(300, Math.max(80, Math.round((2 * targetWords) / chunks.length)));
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
            `Summarize this part as bullet points in about ${partWords} words, keeping its concrete ` +
            `specifics (names, numbers, examples, definitions).\n\n<part>\n${chunk}\n</part>`,
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
