// RAG step 3: GENERATION. Answer a question using only the passages that search found.
//
//   question + top passages (from the browser's search) → LLM → answer with citations
//
// This is the "augmented" part: instead of the model answering from memory (and possibly
// making things up), we hand it the relevant excerpts and tell it to stick to them.
//
// RAG step 4: CHAT HISTORY. LLMs are stateless: each request starts from zero. A
// "conversation" is just the earlier messages sent again with every new question.
import { chat, chatStream, defaultProvider, getProvider, type ChatMessage } from './llm.js';
import type { AskPassage, ChatTurn } from './types.js';

const SYSTEM_PROMPT = `You answer questions about a document. You are given numbered excerpts from it.

Rules:
- Use ONLY the information in the excerpts. Do not add outside knowledge.
- After each statement, cite the excerpt(s) it comes from, like [1] or [2][3].
- If the excerpts don't contain the answer, say clearly that you couldn't find it in the document. Don't guess.
- Answer in the same language as the question, even if the excerpts are in another language.
- Be direct and concise. Use Markdown (short paragraphs, lists) when it helps.
- Earlier messages in the conversation are context for follow-up questions (what "it" or "that" refers to).
  Facts in your answer must still come from the current excerpts.`;

// --- History ----------------------------------------------------------------------
// Every earlier turn costs tokens on every new question, so we keep only the last few,
// and shorten long answers. (Real chat apps summarize old history instead of dropping it.)
const MAX_HISTORY_TURNS = 6;
const MAX_ANSWER_CHARS = 1500;

/** Validate and trim the history the browser sent. */
export function cleanHistory(history: unknown): ChatTurn[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter((t): t is ChatTurn => typeof t?.question === 'string' && typeof t?.answer === 'string')
    .slice(-MAX_HISTORY_TURNS)
    .map((t) => ({
      question: t.question.slice(0, 2000),
      // Old citations like [2] pointed at THAT turn's excerpts, not the current ones:
      // remove them so the model doesn't mix up which [2] is which.
      answer: t.answer.replace(/\[\d+\]/g, '').slice(0, MAX_ANSWER_CHARS),
    }));
}

function historyMessages(history: ChatTurn[]): ChatMessage[] {
  return history.flatMap((t): ChatMessage[] => [
    { role: 'user', content: t.question },
    { role: 'assistant', content: t.answer },
  ]);
}

// --- Query rewriting --------------------------------------------------------------
// A follow-up like "and how long does that take?" is useless for search on its own: it
// has no topic words. So before searching, a quick LLM call rewrites it into a
// standalone question using the conversation ("How long does X take?").
// Also called "query condensing" or "contextualizing the question".
const REWRITE_PROMPT = `Rewrite the user's last question as a standalone search query that can be understood without the conversation.
Replace references like "it", "that", "the second one" with what they refer to.
Keep the same language as the question. If it is already standalone, return it unchanged.
Reply with the rewritten question only: no quotes, no explanation.`;

export async function rewriteQuestion(question: string, history: ChatTurn[]): Promise<string> {
  if (history.length === 0) return question; // nothing to resolve against
  try {
    const conversation = history.map((t) => `User: ${t.question}\nAssistant: ${t.answer.slice(0, 500)}`).join('\n\n');
    const rewritten = await chat(
      [
        { role: 'system', content: REWRITE_PROMPT },
        { role: 'user', content: `Conversation so far:\n${conversation}\n\nLast question: ${question}` },
      ],
      { temperature: 0, maxRetries: 1 },
    );
    return rewritten.trim().replace(/^["']|["']$/g, '').slice(0, 1000) || question;
  } catch (err) {
    // Rewriting only improves search; if it fails, searching the raw question still works.
    console.warn('[answer] question rewrite failed, searching the original question:', err);
    return question;
  }
}

// --- Answering --------------------------------------------------------------------

/** Builds the final user message: the numbered excerpts, then the question. */
function buildPrompt(question: string, passages: AskPassage[]): string {
  const excerpts = passages
    .map((p, i) => `[${i + 1}] (passage ${p.chunk + 1} of the document)\n${p.text}`)
    .join('\n\n');
  return `Excerpts from the document:\n\n${excerpts}\n\nQuestion: ${question}`;
}

/**
 * Stream an answer. Uses the default (fast) model; if it fails before writing anything
 * (rate limit, overload…), tries the large model instead. Returns the model that answered.
 */
export async function answerQuestion(
  question: string,
  passages: AskPassage[],
  history: ChatTurn[],
  onToken: (text: string) => void,
): Promise<string> {
  // system → earlier turns (user/assistant pairs) → excerpts + new question
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...historyMessages(history),
    { role: 'user', content: buildPrompt(question, passages) },
  ];

  const providers = [defaultProvider(), getProvider('large')].filter((p) => p !== null);
  for (const [i, provider] of providers.entries()) {
    let started = false;
    try {
      await chatStream(
        messages,
        (token) => {
          started = true;
          onToken(token);
        },
        { provider },
      );
      return provider.model;
    } catch (err) {
      // Once text has reached the user we can't switch models mid-answer.
      if (started || i === providers.length - 1) throw err;
      console.warn(`[answer] ${provider.model} failed, trying ${providers[i + 1].model}:`, err);
    }
  }
  throw new Error('No model available to answer.');
}
