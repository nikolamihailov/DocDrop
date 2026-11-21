// The ONLY file that talks to the LLM.
// We use plain fetch (no SDK) so you can see exactly what goes over the wire.
// Every provider in .env.example accepts this same request shape.

function config() {
  const { LLM_BASE_URL, LLM_API_KEY, LLM_MODEL } = process.env;
  if (!LLM_BASE_URL || !LLM_MODEL) {
    throw new Error('LLM_BASE_URL and LLM_MODEL must be set. Copy server/.env.example to server/.env');
  }
  return { baseUrl: LLM_BASE_URL.replace(/\/$/, ''), apiKey: LLM_API_KEY, model: LLM_MODEL };
}

function headers(apiKey) {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

/**
 * Send a conversation to the model and get its reply as a string.
 * @param {{role: 'system'|'user'|'assistant', content: string}[]} messages
 */
export async function chat(messages, { temperature = 0.3 } = {}) {
  const { baseUrl, apiKey, model } = config();

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({ model, messages, temperature }),
  });

  if (!res.ok) {
    throw new Error(`LLM request failed (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  // data.usage shows how many tokens you spent. Worth watching while learning.
  if (data.usage) console.log('[llm] tokens:', data.usage);
  return data.choices[0].message.content;
}

export async function listModels() {
  const { baseUrl, apiKey } = config();
  const res = await fetch(`${baseUrl}/models`, { headers: headers(apiKey) });
  if (!res.ok) throw new Error(`Listing models failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.data.map((m) => m.id);
}

export function currentModel() {
  return config().model;
}
