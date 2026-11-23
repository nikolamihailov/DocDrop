// Step 3: ask the LLM for a summary.
// Short docs: one call. Long docs use "map-reduce": summarize each chunk (map),
// then summarize those summaries into one (reduce).
import { chat, type ChatMessage } from './llm.js';
import { chunkText } from './chunk.js';
import type { ProgressStage } from './types.js';

const SYSTEM_PROMPT =
  'You are an assistant that summarizes documents. ' +
  'Be accurate and only use information present in the provided text. ' +
  'Write in the same language as the document.';

// Be explicit about length and format: models follow concrete limits much better than "be brief".
const FINAL_INSTRUCTIONS = `Write a SHORT summary in Markdown, at most 150 words in total.
Use exactly this structure:

## Overview
2–3 sentences saying what the document is and its main purpose or conclusion.

## Key points
3–5 bullet points, one short line each, only the most important ideas.

## Details worth noting
Only if the document has critical names, dates, or numbers: up to 3 bullets. Otherwise omit this section.

Rules:
- Summarize and prioritize; do NOT list every fact from the document.
- No introduction or closing remarks, just the summary.`;

export interface SummaryResult {
  summary: string;
  chunks: number;
}

export async function summarizeDocument(
  text: string,
  onProgress: (progress: ProgressStage) => void = () => {},
): Promise<SummaryResult> {
  const chunkSize = Number(process.env.CHUNK_SIZE) || 12000;
  const chunks = chunkText(text, { chunkSize });

  // Every LLM call reports rate-limit waits, so the user sees why it's slow.
  const ask = (messages: ChatMessage[]) =>
    chat(messages, { onRateLimit: (ms) => onProgress({ stage: 'waiting', seconds: Math.ceil(ms / 1000) }) });

  if (chunks.length === 1) {
    onProgress({ stage: 'summarizing', part: 1, total: 1 });
    const summary = await ask([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `${FINAL_INSTRUCTIONS}\n\n<document>\n${chunks[0]}\n</document>` },
    ]);
    return { summary, chunks: 1 };
  }

  // MAP: one call per chunk. Sequential (not Promise.all) to stay under free-tier rate limits.
  const partials: string[] = [];
  for (const [i, chunk] of chunks.entries()) {
    console.log(`[summarize] chunk ${i + 1}/${chunks.length}`);
    onProgress({ stage: 'summarizing', part: i + 1, total: chunks.length });
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
        `Combine them into a single summary of the whole document.\n\n${FINAL_INSTRUCTIONS}\n\n${combined}`,
    },
  ]);

  return { summary, chunks: chunks.length };
}
