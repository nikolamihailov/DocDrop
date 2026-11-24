// The browser side of RAG. The server sends the document's index (chunks + vectors)
// along with the summary; the page keeps it in memory, and (next step) searches it
// to find the passages that answer a question.
import type { DocumentIndex } from './types';

export interface LoadedIndex {
  model: string;
  dimensions: number;
  chunks: string[];
  /** All vectors back to back: vector i is vectors[i * dimensions … (i + 1) * dimensions]. */
  vectors: Float32Array;
}

/** Unpack the base64 string from the server into a Float32Array (4 bytes per number). */
export function loadIndex(index: DocumentIndex): LoadedIndex {
  const binary = atob(index.vectors);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const vectors = new Float32Array(bytes.buffer);

  if (vectors.length !== index.chunks.length * index.dimensions) {
    throw new Error('Corrupt index: vector data does not match the number of chunks.');
  }
  return { model: index.model, dimensions: index.dimensions, chunks: index.chunks, vectors };
}

/** Vector of chunk i (a view into the big array, no copying). */
export function vectorAt(index: LoadedIndex, i: number): Float32Array {
  return index.vectors.subarray(i * index.dimensions, (i + 1) * index.dimensions);
}

export interface SearchHit {
  /** Position of the passage in the document (0 = first). */
  chunk: number;
  /** Cosine similarity, from -1 to 1. Higher = closer in meaning. */
  score: number;
  text: string;
}

/**
 * RAG step 2: semantic search. Compare the question's vector with EVERY passage vector
 * and return the `topK` most similar passages.
 *
 * "Similar" = cosine similarity: how closely two vectors point in the same direction.
 * All vectors are normalized to length 1 (server/src/rag.ts), and for unit vectors the
 * cosine is simply the DOT PRODUCT: multiply the numbers pairwise and add them up.
 *
 * This is a "brute-force" search: it checks all passages. For a few hundred passages
 * it takes well under a millisecond. Vector databases use clever indexes (e.g. HNSW)
 * to avoid checking everything when there are millions of vectors.
 */
export function search(index: LoadedIndex, query: ArrayLike<number>, topK = 5): SearchHit[] {
  if (query.length !== index.dimensions) {
    throw new Error(`Question vector has ${query.length} numbers, the index has ${index.dimensions}.`);
  }

  const hits: SearchHit[] = index.chunks.map((text, chunk) => {
    const vector = vectorAt(index, chunk);
    let score = 0;
    for (let d = 0; d < index.dimensions; d++) score += vector[d] * query[d];
    return { chunk, score, text };
  });

  return hits.sort((a, b) => b.score - a.score).slice(0, topK);
}
