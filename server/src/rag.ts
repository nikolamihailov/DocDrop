// RAG step 1: build a searchable "index" of a document.
//
//   document text → small chunks → one embedding (vector) per chunk
//
// The index goes to the browser, which keeps it. Later, a question is embedded the
// same way and compared with every chunk vector to find the chunks that answer it.
import { chunkText } from './chunk.js';
import { embed, embeddingConfig } from './embeddings.js';
import { UserError } from './extract.js';
import type { DocumentIndex } from './types.js';

// Much smaller chunks than for summarizing (12,000): a chunk should be about ONE topic,
// so its vector is precise and a search hit points at a specific passage. ~1,500
// characters is a paragraph or three. The overlap keeps sentences on a boundary intact.
const RAG_CHUNK_SIZE = 1500;
const RAG_CHUNK_OVERLAP = 200;

/** Whether embeddings are configured (EMBEDDING_MODEL in .env). */
export function ragEnabled(): boolean {
  return embeddingConfig() !== null;
}

export async function buildIndex(text: string): Promise<DocumentIndex> {
  const config = embeddingConfig();
  if (!config) throw new Error('Q&A is not configured on the server (EMBEDDING_MODEL is not set).');

  const chunks = chunkText(text, { chunkSize: RAG_CHUNK_SIZE, overlap: RAG_CHUNK_OVERLAP });
  const started = Date.now();
  const vectors = await embed(chunks, config);
  const dimensions = vectors[0]?.length ?? 0;
  console.log(`[rag] indexed ${chunks.length} chunks × ${dimensions} dims in ${Date.now() - started}ms`);

  return { model: config.model, dimensions, chunks, vectors: encodeVectors(vectors, dimensions) };
}

/**
 * Pack all vectors into one compact base64 string of 32-bit floats.
 *
 * As JSON, 90 chunks × 768 numbers like 0.012345678 is ~1.4 MB of text. As raw float32
 * it's 90 × 768 × 4 bytes = 276 KB (base64: ~370 KB). The browser unpacks it into a
 * Float32Array, the same structure vector databases use internally.
 *
 * We also NORMALIZE every vector to length 1 here. Then the "cosine similarity" of two
 * vectors (how close their directions are) is just their dot product, which makes the
 * search in the browser simpler and faster. (Shortened Gemini vectors, like 768 dims,
 * aren't normalized by the API, so this step matters.)
 */
function encodeVectors(vectors: number[][], dimensions: number): string {
  const packed = new Float32Array(vectors.length * dimensions);
  vectors.forEach((vector, i) => packed.set(normalize(vector), i * dimensions));
  return Buffer.from(packed.buffer).toString('base64');
}

/** Scale a vector to length 1, keeping its direction. */
function normalize(vector: number[]): number[] {
  const length = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0)) || 1;
  return vector.map((x) => x / length);
}

// RAG step 2: embed a QUESTION so the browser can compare it with the passages.
// It must use the SAME model and size as the index: vectors from different models
// live in different "spaces" and comparing them is meaningless.
export async function embedQuery(text: string, indexModel: string): Promise<number[]> {
  const config = embeddingConfig();
  if (!config) throw new UserError('Q&A is not configured on the server (EMBEDDING_MODEL is not set).');
  if (indexModel !== config.model) {
    throw new UserError('This document was indexed with a different embedding model. Please upload it again.');
  }
  const [vector] = await embed([text], config);
  return normalize(vector);
}
