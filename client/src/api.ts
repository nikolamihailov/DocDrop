// All calls to our Express backend live here, so components never deal with fetch details.
import type {
  AskEvent,
  AskPassage,
  AskRequest,
  ChatTurn,
  EmbedQueryRequest,
  EmbedQueryResponse,
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

  let result: SummarizeResponse | null = null;
  await readNdjson<SummarizeEvent>(res, (event) => {
    if (event.type === 'progress') {
      const { type: _type, ...progress } = event;
      onProgress(progress);
    } else if (event.type === 'result') {
      result = event.result;
    } else {
      throw new Error(event.error);
    }
  });
  if (!result) throw new Error('The connection closed before the summary was ready. Please try again.');
  return result;
}

/**
 * Read a streamed NDJSON response (one JSON event per line), calling `onEvent` for each
 * event as it arrives. Used by both /api/summarize and /api/ask.
 */
async function readNdjson<Event>(res: Response, onEvent: (event: Event) => void): Promise<void> {
  // Errors found before streaming starts (bad request, file too large…) come back
  // as a normal JSON error, so let readJson turn them into an Error.
  if (!res.ok || !res.headers.get('content-type')?.includes('ndjson') || !res.body) {
    await readJson<unknown>(res);
    throw new Error(`Unexpected response from the server (HTTP ${res.status}).`);
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
      if (line.trim()) onEvent(JSON.parse(line) as Event);
    }
  }
}

/**
 * RAG step 3: ask a question about the passages that search found. The answer arrives
 * piece by piece: `onToken` is called with each new bit of text. Returns the model that answered.
 */
export async function askQuestion(
  question: string,
  passages: AskPassage[],
  history: ChatTurn[],
  onToken: (text: string) => void,
): Promise<string> {
  const body: AskRequest = { question, passages, history };
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  let model: string | null = null;
  await readNdjson<AskEvent>(res, (event) => {
    if (event.type === 'token') onToken(event.text);
    else if (event.type === 'done') model = event.model;
    else throw new Error(event.error);
  });
  if (!model) throw new Error('The connection closed before the answer was complete. Please try again.');
  return model;
}

/**
 * RAG: turn a question into a vector, with the same embedding model as the document index.
 * With `history`, the server first rewrites a follow-up into a standalone question;
 * `searchQuery` in the response is what was actually searched.
 */
export async function embedQuery(text: string, model: string, history: ChatTurn[] = []): Promise<EmbedQueryResponse> {
  const body: EmbedQueryRequest = { text, model, history };
  const res = await fetch('/api/embed-query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readJson<EmbedQueryResponse>(res);
}

export async function getHealth(): Promise<HealthResponse> {
  return readJson<HealthResponse>(await fetch('/api/health'));
}
