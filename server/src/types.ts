// Shapes of the JSON the API returns. The client has a copy in client/src/types.ts:
// keep the two in sync when you change the API.

/** Body of POST /api/summarize. `data` is the file's bytes, base64-encoded. */
export interface SummarizeRequest {
  fileName: string;
  data: string;
}

export interface SummaryStats {
  characters: number;
  approxTokens: number;
  chunks: number;
  model: string;
  ms: number;
  /** Word budget the summary was asked for (scales with the document). */
  targetWords: number;
}

/**
 * A searchable index of the document, for Q&A (RAG). The browser keeps it.
 * Chunk i belongs to vector i.
 */
export interface DocumentIndex {
  /** Embedding model that made the vectors; questions must use the same one. */
  model: string;
  /** Numbers per vector. */
  dimensions: number;
  /** The document split into small passages. */
  chunks: string[];
  /** All vectors, normalized, packed as base64-encoded float32 (chunks.length × dimensions). */
  vectors: string;
}

export interface SummarizeResponse {
  fileName: string;
  summary: string;
  stats: SummaryStats;
  /** null when Q&A is unavailable; then indexError says why. */
  index: DocumentIndex | null;
  indexError: string | null;
}

/** What the server is doing right now, streamed to the client while it works. */
export type ProgressStage =
  | { stage: 'extracting' }
  | { stage: 'summarizing'; part: number; total: number; model: string }
  | { stage: 'combining' }
  | { stage: 'fallback'; model: string } // the long-document model failed, using this one instead
  | { stage: 'waiting'; seconds: number }; // rate-limited by the LLM provider

/**
 * POST /api/summarize streams these as NDJSON: one JSON object per line.
 * Zero or more `progress` events, then exactly one `result` or `error`.
 */
export type SummarizeEvent =
  | ({ type: 'progress' } & ProgressStage)
  | { type: 'result'; result: SummarizeResponse }
  | { type: 'error'; error: string };

/** One earlier exchange in the conversation. The LLM remembers nothing, so we resend these. */
export interface ChatTurn {
  question: string;
  answer: string;
}

/** Body of POST /api/embed-query: turn a question into a vector (RAG search). */
export interface EmbedQueryRequest {
  text: string;
  /** The index's embedding model: the question must be embedded with the same one. */
  model: string;
  /** Earlier turns: used to rewrite a follow-up ("and the second one?") into a standalone question. */
  history?: ChatTurn[];
}

export interface EmbedQueryResponse {
  /** Normalized (length 1), so a dot product with a passage vector is their cosine similarity. */
  vector: number[];
  /** The text that was actually embedded: the question itself, or its rewritten standalone version. */
  searchQuery: string;
}

/** A passage the browser's search picked, sent along with the question. */
export interface AskPassage {
  /** Position of the passage in the document (0 = first). */
  chunk: number;
  text: string;
}

/** Body of POST /api/ask: RAG step 3, answer a question from the given passages. */
export interface AskRequest {
  question: string;
  passages: AskPassage[];
  /** Earlier turns of the conversation, oldest first. */
  history?: ChatTurn[];
}

/**
 * POST /api/ask streams these as NDJSON: many `token` events (pieces of the answer as the
 * model writes it), then exactly one `done` or `error`.
 */
export type AskEvent =
  | { type: 'token'; text: string }
  | { type: 'done'; model: string }
  | { type: 'error'; error: string };

export interface HealthResponse {
  ok: boolean;
  model: string | null;
  /** Model used for long documents, if one is configured. */
  largeModel: string | null;
}

export interface ErrorResponse {
  error: string;
}
