import { useEffect, useRef, useState, type FormEvent } from 'react';
import Markdown from 'react-markdown';
import { CircleAlert, LoaderCircle, MessageCircleQuestion, RotateCcw, Search, Send } from 'lucide-react';
import { askQuestion, embedQuery } from '../api';
import { search, type LoadedIndex, type SearchHit } from '../rag';
import type { ChatTurn } from '../types';
import { shortModel } from './ProgressCard';

interface AskPanelProps {
  index: LoadedIndex;
}

// How many passages to give the LLM. More = more context, but more noise and tokens.
const TOP_K = 5;

interface Turn {
  question: string;
  /** What was actually searched: the question, or its standalone rewrite (step 4). */
  searchQuery: string | null;
  /** Passages the search found (step 2); they become the numbered sources [1]…[5]. */
  sources: SearchHit[];
  /** The answer so far: it grows as tokens stream in (step 3). */
  answer: string;
  /** Model that answered, once done. */
  model: string | null;
  status: 'searching' | 'answering' | 'done' | 'error';
  error?: string;
  embedMs?: number;
  searchMs?: number;
}

/**
 * A chat about the document: the complete RAG loop, with memory.
 *   1. Retrieval: rewrite a follow-up into a standalone question + embed it (server),
 *      find the closest passages (browser)
 *   2. Generation: question + passages + earlier turns → LLM, answer streamed with citations
 */
export default function AskPanel({ index }: AskPanelProps) {
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  // Opened sources, keyed "turn-source" (e.g. "2-3" = source [3] of the 3rd turn).
  const [openSources, setOpenSources] = useState<Set<string>>(new Set());
  const formRef = useRef<HTMLFormElement>(null);
  const busy = turns.some((t) => t.status === 'searching' || t.status === 'answering');

  // Keep the input in view as the conversation grows.
  useEffect(() => {
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [turns.length]);

  /** Update one turn by position (the conversation is a list of turns). */
  function updateTurn(i: number, change: (t: Turn) => Partial<Turn>) {
    setTurns((all) => all.map((t, j) => (j === i ? { ...t, ...change(t) } : t)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;

    // The LLM is stateless: the conversation so far is sent along with every question.
    // Only finished turns count; failed ones carry no useful answer.
    const history: ChatTurn[] = turns
      .filter((t) => t.status === 'done')
      .map((t) => ({ question: t.question, answer: t.answer }));

    const i = turns.length; // position of the new turn
    setTurns((all) => [...all, { question: q, searchQuery: null, sources: [], answer: '', model: null, status: 'searching' }]);
    setQuestion('');

    try {
      // 1. RETRIEVAL (with the history, the server may rewrite a follow-up first)
      const t0 = performance.now();
      const { vector, searchQuery } = await embedQuery(q, index.model, history);
      const t1 = performance.now();
      const sources = search(index, vector, TOP_K);
      const t2 = performance.now();
      updateTurn(i, () => ({ searchQuery, sources, status: 'answering', embedMs: t1 - t0, searchMs: t2 - t1 }));

      // 2. GENERATION: append each streamed piece of text to the answer as it arrives.
      const model = await askQuestion(
        q,
        sources.map(({ chunk, text }) => ({ chunk, text })),
        history,
        (token) => updateTurn(i, (t) => ({ answer: t.answer + token })),
      );
      updateTurn(i, () => ({ model, status: 'done' }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateTurn(i, () => ({ status: 'error', error: message }));
    }
  }

  function newChat() {
    setTurns([]);
    setOpenSources(new Set());
  }

  function toggleSource(key: string, open?: boolean) {
    setOpenSources((all) => {
      const next = new Set(all);
      if (open ?? !next.has(key)) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  /** Clicking a citation like [2] opens that source and scrolls to it. */
  function showSource(turn: number, n: number) {
    toggleSource(`${turn}-${n}`, true);
    requestAnimationFrame(() =>
      document.getElementById(`source-${turn}-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
    );
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white shadow-xl shadow-zinc-900/5 dark:border-white/10 dark:bg-zinc-900/60 dark:shadow-black/20">
      <header className="flex items-start justify-between gap-4 border-b border-zinc-200 px-6 py-4 dark:border-white/10">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-brand-600 uppercase dark:text-brand-400">
            <MessageCircleQuestion className="size-4" />
            Ask about this document
          </p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Answers come only from the document, with the passages they're based on. Follow-up questions work too.
          </p>
        </div>
        {turns.length > 0 && (
          <button
            type="button"
            onClick={newChat}
            disabled={busy}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/10"
          >
            <RotateCcw className="size-4" />
            New chat
          </button>
        )}
      </header>

      {turns.length > 0 && (
        <div className="space-y-8 border-b border-zinc-200 px-6 py-5 dark:border-white/10">
          {turns.map((turn, t) => (
            <TurnView
              key={t}
              turn={turn}
              t={t}
              total={index.chunks.length}
              openSources={openSources}
              onToggleSource={(n) => toggleSource(`${t}-${n}`)}
              onCite={(n) => showSource(t, n)}
            />
          ))}
        </div>
      )}

      <form ref={formRef} onSubmit={handleSubmit} className="flex gap-2 px-6 py-5">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={turns.length ? 'Ask a follow-up question…' : 'e.g. What are the main conclusions?'}
          maxLength={2000}
          className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm outline-none placeholder:text-zinc-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-white/10 dark:bg-white/5"
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          className="flex shrink-0 items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
          Ask
        </button>
      </form>
    </section>
  );
}

interface TurnViewProps {
  turn: Turn;
  /** Position of this turn in the conversation. */
  t: number;
  total: number;
  openSources: Set<string>;
  onToggleSource: (n: number) => void;
  onCite: (n: number) => void;
}

function TurnView({ turn, t, total, openSources, onToggleSource, onCite }: TurnViewProps) {
  const rewritten = turn.searchQuery && turn.searchQuery !== turn.question;

  return (
    <div className="space-y-3">
      {/* The question, chat-bubble style */}
      <div className="flex flex-col items-end gap-1">
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-4 py-2 text-sm text-white">{turn.question}</p>
        {/* Step 4: the follow-up was rewritten into a standalone question for the search */}
        {rewritten && (
          <p className="flex max-w-[85%] items-center gap-1 text-right text-xs text-zinc-500 dark:text-zinc-400">
            <Search className="size-3 shrink-0" />
            Searched for: <span className="italic">{turn.searchQuery}</span>
          </p>
        )}
      </div>

      {/* The answer (step 3) */}
      <div>
        {turn.status === 'searching' && <Waiting label="Searching the document…" />}
        {turn.status === 'answering' && !turn.answer && <Waiting label="Writing the answer…" />}
        {turn.answer && (
          <div className="prose prose-zinc prose-sm dark:prose-invert prose-p:my-2 max-w-none">
            <Markdown
              components={{
                // Citations are turned into links to "#source-N" (see linkCitations below).
                a: ({ href, children }) => {
                  const n = Number(href?.match(/^#source-(\d+)$/)?.[1]);
                  return n ? (
                    <button
                      type="button"
                      onClick={() => onCite(n)}
                      className="mx-0.5 rounded bg-brand-500/15 px-1 text-xs font-semibold text-brand-700 no-underline hover:bg-brand-500/25 dark:text-brand-300"
                    >
                      {children}
                    </button>
                  ) : (
                    <a href={href}>{children}</a>
                  );
                },
              }}
            >
              {linkCitations(turn.answer, turn.sources.length)}
            </Markdown>
          </div>
        )}
        {turn.model && <p className="mt-1 text-xs text-zinc-400">answered by {shortModel(turn.model)}</p>}
        {turn.status === 'error' && (
          <p className="flex items-start gap-2 text-sm text-red-600 dark:text-red-300">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            {turn.error}
          </p>
        )}
      </div>

      {/* The sources (step 2): what the answer is based on */}
      {turn.sources.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold tracking-wider text-zinc-500 uppercase dark:text-zinc-400">
            Sources
            <span className="ml-2 font-normal normal-case">
              · top {turn.sources.length} of {total} passages · search {Math.round(turn.embedMs ?? 0)} ms +{' '}
              {(turn.searchMs ?? 0) < 1 ? '<1' : Math.round(turn.searchMs ?? 0)} ms
            </span>
          </p>
          <div className="space-y-2">
            {turn.sources.map((hit, i) => (
              <Source
                key={hit.chunk}
                id={`source-${t}-${i + 1}`}
                n={i + 1}
                hit={hit}
                total={total}
                open={openSources.has(`${t}-${i + 1}`)}
                onToggle={() => onToggleSource(i + 1)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Turn "[2]" in the answer into a Markdown link to source 2, so it renders as a button. */
function linkCitations(answer: string, count: number): string {
  return answer.replace(/\[(\d+)\]/g, (match, n: string) =>
    Number(n) >= 1 && Number(n) <= count ? `[\\[${n}\\]](#source-${n})` : match,
  );
}

function Waiting({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
      <LoaderCircle className="size-4 animate-spin text-brand-500" />
      {label}
    </p>
  );
}

interface SourceProps {
  id: string;
  n: number;
  hit: SearchHit;
  total: number;
  open: boolean;
  onToggle: () => void;
}

function Source({ id, n, hit, total, open, onToggle }: SourceProps) {
  return (
    <article id={id} className="scroll-mt-4 rounded-xl border border-zinc-200 p-3 dark:border-white/10">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 text-left text-xs">
        <span className="rounded bg-brand-500/15 px-1.5 py-0.5 font-semibold text-brand-700 dark:text-brand-300">
          [{n}]
        </span>
        {/* Cosine similarity with the question. Related text typically scores ~0.6–0.8. */}
        <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-zinc-100 dark:bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-500 to-orange-500"
            style={{ width: `${Math.max(0, hit.score) * 100}%` }}
          />
        </div>
        <span className="text-zinc-500 tabular-nums dark:text-zinc-400">{hit.score.toFixed(2)}</span>
        <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-300">{hit.text.slice(0, 120)}</span>
        <span className="shrink-0 text-zinc-400">
          {hit.chunk + 1}/{total}
        </span>
      </button>
      {open && (
        <p className="mt-3 border-t border-zinc-100 pt-3 text-sm whitespace-pre-line text-zinc-700 dark:border-white/5 dark:text-zinc-300">
          {hit.text}
        </p>
      )}
    </article>
  );
}
