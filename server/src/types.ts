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
}

export interface SummarizeResponse {
  fileName: string;
  summary: string;
  stats: SummaryStats;
}

export interface HealthResponse {
  ok: boolean;
  model: string | null;
}

export interface ErrorResponse {
  error: string;
}
