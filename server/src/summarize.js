// Step 3: ask the LLM for a summary.
// Short docs: one call. Long docs use "map-reduce": summarize each chunk (map),
// then summarize those summaries into one (reduce).
import { chat } from './llm.js';
import { chunkText } from './chunk.js';

const SYSTEM_PROMPT =
  'You are an assistant that summarizes documents. ' +
  'Be accurate and only use information present in the provided text. ' +
  'Write in the same language as the document.';

const FINAL_INSTRUCTIONS =
  'Write a summary with:\n' +
  '1. A one-paragraph overview.\n' +
  '2. The key points as a bulleted list.\n' +
  '3. Any important names, dates, or numbers.';

export async function summarizeDocument(text) {
  const chunkSize = Number(process.env.CHUNK_SIZE) || 12000;
  const chunks = chunkText(text, { chunkSize });

  if (chunks.length === 1) {
    const summary = await chat([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `${FINAL_INSTRUCTIONS}\n\n<document>\n${chunks[0]}\n</document>` },
    ]);
    return { summary, chunks: 1 };
  }

  // MAP: one call per chunk. Sequential (not Promise.all) to stay under free-tier rate limits.
  const partials = [];
  for (const [i, chunk] of chunks.entries()) {
    console.log(`[summarize] chunk ${i + 1}/${chunks.length}`);
    partials.push(
      await chat([
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

  // REDUCE: combine the partial summaries into one.
  const combined = partials
    .map((p, i) => `<part_summary index="${i + 1}">\n${p}\n</part_summary>`)
    .join('\n\n');

  const summary = await chat([
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
