// Step 2: split long text into pieces that fit in the model's context window.
// You will reuse this for RAG: there, chunks get turned into embeddings and
// stored for search instead of being summarized.

interface ChunkOptions {
  /** Max characters per chunk. */
  chunkSize?: number;
  /** Characters repeated between neighbouring chunks. */
  overlap?: number;
}

/**
 * Split text into chunks of at most `chunkSize` characters.
 * Prefers to cut at paragraph breaks, and overlaps chunks slightly so a
 * sentence that straddles a boundary is not lost.
 */
export function chunkText(text: string, { chunkSize = 12000, overlap = 400 }: ChunkOptions = {}): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);

    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf('\n\n', end);
      if (paragraphBreak > start + chunkSize / 2) end = paragraphBreak;
    }

    chunks.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = end - overlap;
  }

  return chunks.filter(Boolean);
}
