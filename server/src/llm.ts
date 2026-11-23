// The ONLY file that talks to the LLM.
// We use plain fetch (no SDK) so you can see exactly what goes over the wire.
// Every provider in .env.example accepts this same request shape.

export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
}

interface ChatOptions {
  temperature?: number;
  /** Called before waiting out a rate limit, so the caller can tell the user. */
  onRateLimit?: (waitMs: number) => void;
}

// Only the parts of the provider's response we actually use.
interface ChatCompletionResponse {
  choices: { message: { content: string | null } }[];
  usage?: Record<string, unknown>;
}

interface ModelsResponse {
  data: { id: string }[];
}

interface LlmConfig {
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
}

function config(): LlmConfig {
  const { LLM_BASE_URL, LLM_API_KEY, LLM_MODEL } = process.env;
  if (!LLM_BASE_URL || !LLM_MODEL) {
    throw new Error('LLM_BASE_URL and LLM_MODEL must be set. Copy server/.env.example to server/.env');
  }
  return { baseUrl: LLM_BASE_URL.replace(/\/$/, ''), apiKey: LLM_API_KEY, model: LLM_MODEL };
}

function headers(apiKey: string | undefined): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

const MAX_RETRIES = 5;
const MAX_WAIT_MS = 30_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * How long the provider wants us to wait after a 429 ("too many requests").
 * Groq/OpenAI send a `retry-after` header in seconds; we fall back to exponential backoff.
 */
function retryDelayMs(res: Response, attempt: number): number {
  const header = Number(res.headers.get('retry-after'));
  const ms = header > 0 ? header * 1000 : 2 ** attempt * 1000;
  return Math.min(ms + 250, MAX_WAIT_MS); // small buffer so we don't arrive a moment too early
}

/** Send a conversation to the model and get its reply as a string. Retries on 429. */
export async function chat(
  messages: ChatMessage[],
  { temperature = 0.3, onRateLimit }: ChatOptions = {},
): Promise<string> {
  const { baseUrl, apiKey, model } = config();

  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: headers(apiKey),
      body: JSON.stringify({ model, messages, temperature }),
    });

    // Rate limited (free tiers allow only so many tokens per minute): wait and try again.
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const wait = retryDelayMs(res, attempt);
      console.log(`[llm] rate limited, retrying in ${wait}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      onRateLimit?.(wait);
      await res.text(); // drain the body so the connection can be reused
      await sleep(wait);
      continue;
    }
    break;
  }

  if (!res.ok) {
    if (res.status === 429) {
      throw new Error('The AI provider is rate-limiting us (free tier). Wait a minute and try again.');
    }
    throw new Error(`LLM request failed (${res.status}): ${await res.text()}`);
  }

  // res.json() returns `any`; we tell TypeScript what shape we expect.
  // (It's a promise, not a runtime check. A schema library like zod would validate it.)
  const data = (await res.json()) as ChatCompletionResponse;
  // data.usage shows how many tokens you spent. Worth watching while learning.
  if (data.usage) console.log('[llm] tokens:', data.usage);
  return data.choices[0]?.message.content ?? '';
}

export async function listModels(): Promise<string[]> {
  const { baseUrl, apiKey } = config();
  const res = await fetch(`${baseUrl}/models`, { headers: headers(apiKey) });
  if (!res.ok) throw new Error(`Listing models failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as ModelsResponse;
  return data.data.map((m) => m.id);
}

export function currentModel(): string {
  return config().model;
}
