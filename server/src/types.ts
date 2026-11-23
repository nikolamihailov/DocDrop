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

export interface SummarizeResponse {
  fileName: string;
  summary: string;
  stats: SummaryStats;
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

export interface HealthResponse {
  ok: boolean;
  model: string | null;
  /** Model used for long documents, if one is configured. */
  largeModel: string | null;
}

export interface ErrorResponse {
  error: string;
}
