// Copy of server/src/types.ts: keep the two in sync when you change the API.

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
