// All calls to our Express backend live here, so components never deal with fetch details.
import type {
  ErrorResponse,
  HealthResponse,
  ProgressStage,
  SummarizeEvent,
  SummarizeRequest,
  SummarizeResponse,
} from './types';

// Friendlier text for Vercel's own error codes (sent as plain text, not JSON).
const VERCEL_ERRORS: Record<string, string> = {
  FUNCTION_PAYLOAD_TOO_LARGE: 'The file is too large for the server (max 3 MB).',
  FUNCTION_INVOCATION_TIMEOUT: 'The server took too long to answer. Try a shorter document.',
};

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // Not JSON, so our Express code didn't answer. Either the backend isn't running
    // (locally, Vite's proxy returns an empty body) or the hosting platform answered,
    // e.g. Vercel's plain-text errors like "FUNCTION_INVOCATION_TIMEOUT".
    const code = text.match(/^[A-Z][A-Z_]{5,}$/m)?.[0];
    if (code) throw new Error(VERCEL_ERRORS[code] ?? `Server error ${res.status}: ${code}`);
    if (import.meta.env.DEV && !text) {
      throw new Error(`Server returned no data (HTTP ${res.status}). Is the backend running? (cd server && npm run dev)`);
    }
    throw new Error(`Server error (HTTP ${res.status}). Please try again.`);
  }

  if (!res.ok) {
    throw new Error((data as ErrorResponse).error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

/** Read a file as base64 text (without the "data:...;base64," prefix). */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Upload a file and wait for its summary, calling `onProgress` as the server reports
 * what it's doing. The server streams NDJSON: one JSON event per line.
 */
export async function summarizeFile(
  file: File,
  onProgress: (progress: ProgressStage) => void,
): Promise<SummarizeResponse> {
  // We send the file as base64 inside JSON instead of a binary multipart upload:
  // Vercel rejects binary request bodies over ~1 MB, but lets text through.
  const body: SummarizeRequest = { fileName: file.name, data: await readAsBase64(file) };
  const res = await fetch('/api/summarize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  // Errors found before streaming starts (bad request, file too large…) come back
  // as a normal JSON error, so let readJson turn them into an Error.
  if (!res.ok || !res.headers.get('content-type')?.includes('ndjson') || !res.body) {
    return readJson<SummarizeResponse>(res);
  }

  // Read the stream chunk by chunk. A chunk can end in the middle of a line, so we
  // keep the unfinished part in `buffer` until its newline arrives.
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as SummarizeEvent;
      if (event.type === 'progress') {
        const { type: _type, ...progress } = event;
        onProgress(progress);
      } else if (event.type === 'result') {
        return event.result;
      } else {
        throw new Error(event.error);
      }
    }
  }
  throw new Error('The connection closed before the summary was ready. Please try again.');
}

export async function getHealth(): Promise<HealthResponse> {
  return readJson<HealthResponse>(await fetch('/api/health'));
}
