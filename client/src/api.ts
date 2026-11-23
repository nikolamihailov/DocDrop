// All calls to our Express backend live here, so components never deal with fetch details.
import type { ErrorResponse, HealthResponse, SummarizeResponse } from './types';

async function readJson<T>(res: Response): Promise<T> {
  // If Express is down, Vite's proxy answers with an empty body (not JSON).
  const data: unknown = await res.json().catch(() => {
    throw new Error(`Server returned no data (HTTP ${res.status}). Is the backend running? (cd server && npm run dev)`);
  });
  if (!res.ok) {
    throw new Error((data as ErrorResponse).error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export async function summarizeFile(file: File): Promise<SummarizeResponse> {
  // Files are sent as multipart/form-data; the server reads the "file" field with multer.
  const body = new FormData();
  body.append('file', file);
  const res = await fetch('/api/summarize', { method: 'POST', body });
  return readJson<SummarizeResponse>(res);
}

export async function getHealth(): Promise<HealthResponse> {
  return readJson<HealthResponse>(await fetch('/api/health'));
}
