// Embeddings: turning text into vectors (lists of numbers) that capture its MEANING.
// Texts about similar things get vectors that point in similar directions, even when
// they share no words, or are in different languages. That's what makes semantic
// search ("find the chunks that answer this question") possible: the "R" in RAG.
//
// Like llm.ts, this is a plain OpenAI-compatible HTTP call: POST /embeddings.
import { postJson, type LlmProvider } from './llm.js';

export interface EmbeddingConfig {
  provider: Pick<LlmProvider, 'name' | 'baseUrl' | 'apiKey'>;
  model: string;
  /** Vector length. Fewer numbers = smaller and faster, slightly less precise. */
  dimensions: number | undefined;
}

/**
 * Embeddings are on when EMBEDDING_MODEL is set. URL and key default to the
 * LARGE_LLM_* provider (Gemini), since Groq doesn't offer embeddings.
 */
export function embeddingConfig(): EmbeddingConfig | null {
  const model = process.env.EMBEDDING_MODEL;
  const baseUrl = process.env.EMBEDDING_BASE_URL || process.env.LARGE_LLM_BASE_URL;
  if (!model || !baseUrl) return null;
  return {
    provider: {
      name: 'large',
      baseUrl: baseUrl.replace(/\/$/, ''),
      apiKey: process.env.EMBEDDING_API_KEY || process.env.LARGE_LLM_API_KEY,
    },
    model,
    dimensions: Number(process.env.EMBEDDING_DIMENSIONS) || undefined,
  };
}

interface EmbeddingsResponse {
  data: { embedding: number[]; index: number }[];
}

// Gemini accepts at most 100 texts per request.
const BATCH_SIZE = 100;

/** Embed many texts, in batches. Returns one vector per text, in the same order. */
export async function embed(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE);
    const data = await postJson<EmbeddingsResponse>(
      config.provider,
      '/embeddings',
      config.model,
      { input: batch, ...(config.dimensions ? { dimensions: config.dimensions } : {}) },
      // The free tier counts every text in a batch against a per-minute quota,
      // so a big document can need a ~1 minute wait between batches.
      { maxRetries: 3 },
    );
    // `index` says which input each vector belongs to; sort to be safe.
    vectors.push(...data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
  }
  return vectors;
}
