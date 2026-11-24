// The ONLY file that talks to LLMs.
// We use plain fetch (no SDK) so you can see exactly what goes over the wire.
// Every provider in .env.example accepts this same "OpenAI-compatible" request shape,
// so a provider is just three settings: base URL, API key and model name.

export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
}

/**
 * We can have two providers configured:
 * - `default` (LLM_*): used for normal-sized documents. Groq: very fast, small rate limits.
 * - `large` (LARGE_LLM_*, optional): used for long documents. Gemini: a huge context
 *   window, so a whole long document fits in ONE call instead of many small ones.
 */
export type ProviderName = 'default' | 'large';

export interface LlmProvider {
  name: ProviderName;
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
  /**
   * For "reasoning" models (gpt-oss, Gemini Flash…): how much they think before
   * answering: "low" | "medium" | "high". Unset = the provider's default. Summaries
   * don't need deep thought, and on "medium" gpt-oss sometimes spent its entire
   * output budget reasoning (e.g. counting words) and returned an empty answer.
   */
  reasoningEffort: string | undefined;
}

/** Returns the provider's settings, or null if it isn't configured. */
export function getProvider(name: ProviderName): LlmProvider | null {
  const prefix = name === 'default' ? 'LLM_' : 'LARGE_LLM_';
  const baseUrl = process.env[`${prefix}BASE_URL`];
  const model = process.env[`${prefix}MODEL`];
  if (!baseUrl || !model) return null;
  return {
    name,
    baseUrl: baseUrl.replace(/\/$/, ''),
    apiKey: process.env[`${prefix}API_KEY`],
    model,
    reasoningEffort: process.env[`${prefix}REASONING_EFFORT`] || undefined,
  };
}

/** The default provider must exist; the app can't work without it. */
export function defaultProvider(): LlmProvider {
  const provider = getProvider('default');
  if (!provider) {
    throw new Error('LLM_BASE_URL and LLM_MODEL must be set. Copy server/.env.example to server/.env');
  }
  return provider;
}

interface ChatOptions {
  /** Which provider to call. Defaults to the default provider. */
  provider?: LlmProvider;
  temperature?: number;
  /** How many times to retry after a 429 (rate limited) or 503 (overloaded) before giving up. */
  maxRetries?: number;
  /** Called before waiting out a rate limit, so the caller can tell the user. */
  onRateLimit?: (waitMs: number) => void;
}

// Only the parts of the provider's response we actually use.
interface ChatCompletionResponse {
  // Normally a string, but some providers (Gemini) occasionally return an array of parts.
  choices: { message: { content: string | { text?: string }[] | null }; finish_reason?: string }[];
  usage?: Record<string, unknown>;
}

interface ModelsResponse {
  data: { id: string }[];
}

function headers(apiKey: string | undefined): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

// If the provider asks us to wait longer than this, we don't: it's a daily limit
// (Groq's free tier also caps tokens PER DAY, then asks for waits of ~20 minutes+),
// and failing fast lets the caller switch to the other provider instead.
const MAX_WAIT_MS = 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * How long the provider wants us to wait after a 429/503.
 * Groq/OpenAI send a `retry-after` header in seconds; we fall back to exponential backoff.
 */
function retryDelayMs(res: Response, attempt: number): number {
  const header = Number(res.headers.get('retry-after'));
  const ms = header > 0 ? header * 1000 : 2 ** attempt * 1000;
  return ms + 250; // small buffer so we don't arrive a moment too early
}

// 429 = rate limited (free tiers allow only so many tokens per minute),
// 503 = the model is overloaded ("high demand"). Both are usually temporary.
const RETRYABLE_STATUSES = [429, 503];

/** Send a conversation to a model and get its reply as a string. Retries on 429/503. */
export async function chat(
  messages: ChatMessage[],
  { provider = defaultProvider(), temperature = 0.3, maxRetries = 5, onRateLimit }: ChatOptions = {},
): Promise<string> {
  const { baseUrl, apiKey, model, reasoningEffort } = provider;

  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: headers(apiKey),
      body: JSON.stringify({
        model,
        messages,
        temperature,
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      }),
    });

    // Temporary problem: wait and try again, unless the wait is unreasonably long.
    if (RETRYABLE_STATUSES.includes(res.status) && attempt < maxRetries) {
      const wait = retryDelayMs(res, attempt);
      if (wait > MAX_WAIT_MS) {
        const minutes = Math.ceil(wait / 60_000);
        console.log(`[llm:${provider.name}] ${res.status}, provider asks to wait ~${minutes} min: giving up`);
        await res.text();
        throw new Error(`${model}: free-tier limit reached for now (available again in ~${minutes} min).`);
      }
      console.log(`[llm:${provider.name}] ${res.status}, retrying in ${wait}ms (attempt ${attempt + 1}/${maxRetries})`);
      onRateLimit?.(wait);
      await res.text(); // drain the body so the connection can be reused
      await sleep(wait);
      continue;
    }
    break;
  }

  if (!res.ok) {
    if (res.status === 429) {
      throw new Error(`${model}: free-tier rate limit reached. Wait a minute and try again.`);
    }
    if (res.status === 503) {
      throw new Error(`${model} is overloaded right now. Please try again in a moment.`);
    }
    throw new Error(`LLM request to ${model} failed (${res.status}): ${await res.text()}`);
  }

  // res.json() returns `any`; we tell TypeScript what shape we expect.
  // (It's a promise, not a runtime check. A schema library like zod would validate it.)
  const data = (await res.json()) as ChatCompletionResponse;
  // data.usage shows how many tokens you spent. Worth watching while learning.
  if (data.usage) console.log(`[llm:${provider.name}] ${model} tokens:`, data.usage);

  const choice = data.choices[0];
  const content = choice?.message.content;
  const text = (Array.isArray(content) ? content.map((part) => part.text ?? '').join('') : (content ?? '')).trim();

  // An empty answer is a failure, not a result. Typical cause: finish_reason "length",
  // meaning a reasoning model used its whole output budget thinking. Throwing lets the
  // caller fall back to another model instead of showing a blank summary.
  if (!text) {
    throw new Error(`${model} returned an empty answer (finish_reason: ${choice?.finish_reason ?? 'unknown'}). Please try again.`);
  }
  return text;
}

export async function listModels(provider: LlmProvider = defaultProvider()): Promise<string[]> {
  const res = await fetch(`${provider.baseUrl}/models`, { headers: headers(provider.apiKey) });
  if (!res.ok) throw new Error(`Listing models failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as ModelsResponse;
  return data.data.map((m) => m.id);
}
