import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUp, ChevronDown, CircleAlert, FileText, MessagesSquare, RotateCcw } from 'lucide-react';
import { askQuestion, embedQuery } from '../api';
import { search, type LoadedIndex, type SearchHit } from '../rag';
import type { ChatTurn } from '../types';

interface ChatPanelProps {
  index: LoadedIndex;
}

// --- Retrieval strategy -------------------------------------------------------------
// If the whole document is small, send ALL of it with every question: nothing can be
// missed, and no search is needed. (Searching a 6-passage document for the "top 5"
// can drop exactly the passage that has the answer.) Only bigger documents need RAG
// search. ~12,000 characters is ~3,000 tokens: well within one Groq request.
const WHOLE_DOCUMENT_MAX_CHARS = 12_000;
// For bigger documents: how many passages search picks. More = more context, more tokens.
const TOP_K = 6;

const SUGGESTIONS = ['What is this document about?', 'What are the most important points?', 'Is there anything I need to do?'];

interface Turn {
  question: string;
  /** What was searched (the question or its standalone rewrite); null when the whole document was sent. */
  searchQuery: string | null;
  /** Passages the answer is based on; they're the numbered sources [1], [2]… */
  sources: SearchHit[];
  /** The answer so far: it grows as tokens stream in. */
  answer: string;
  status: 'thinking' | 'answering' | 'done' | 'error';
  error?: string;
}

/**
 * Chat about the document, RAG behind the scenes:
 *   1. pick the passages: the whole document if it's small, otherwise search (rag.ts)
 *   2. send question + passages + earlier turns to the LLM, stream back the answer
 */
export default function ChatPanel({ index }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const messagesRef = useRef<HTMLDivElement>(null);
  const busy = turns.some((t) => t.status === 'thinking' || t.status === 'answering');

  const wholeDocument = useMemo(
    () => index.chunks.reduce((sum, c) => sum + c.length, 0) <= WHOLE_DOCUMENT_MAX_CHARS,
    [index],
  );

  // Follow the conversation: keep the newest message in view while the answer streams.
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  function updateTurn(i: number, change: (t: Turn) => Partial<Turn>) {
    setTurns((all) => all.map((t, j) => (j === i ? { ...t, ...change(t) } : t)));
  }

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;

    // The LLM is stateless: the conversation so far goes along with every question.
    const history: ChatTurn[] = turns
      .filter((t) => t.status === 'done')
      .map((t) => ({ question: t.question, answer: t.answer }));

    const i = turns.length;
    setTurns((all) => [...all, { question: q, searchQuery: null, sources: [], answer: '', status: 'thinking' }]);
    setInput('');

    try {
      // 1. RETRIEVAL
      let sources: SearchHit[];
      let searchQuery: string | null = null;
      if (wholeDocument) {
        sources = index.chunks.map((text, chunk) => ({ chunk, text, score: 1 }));
      } else {
        const embedded = await embedQuery(q, index.model, history); // follow-ups get rewritten first
        searchQuery = embedded.searchQuery;
        sources = search(index, embedded.vector, TOP_K);
      }
      updateTurn(i, () => ({ sources, searchQuery, status: 'answering' }));

      // 2. GENERATION, streamed
      await askQuestion(
        q,
        sources.map(({ chunk, text }) => ({ chunk, text })),
        history,
        (token) => updateTurn(i, (t) => ({ answer: t.answer + token })),
      );
      updateTurn(i, () => ({ status: 'done' }));
    } catch (err) {
      updateTurn(i, () => ({ status: 'error', error: err instanceof Error ? err.message : String(err) }));
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void ask(input);
  }

  return (
    <section className="flex max-h-[80vh] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl shadow-zinc-900/5 lg:h-full lg:max-h-none dark:border-white/10 dark:bg-zinc-900/60 dark:shadow-black/20">
      <header className="flex items-center justify-between gap-3 border-b border-zinc-200 px-5 py-3 dark:border-white/10">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <MessagesSquare className="size-4 text-brand-500" />
          Chat about this document
        </p>
        {turns.length > 0 && (
          <button
            type="button"
            onClick={() => setTurns([])}
            disabled={busy}
            title="Start a new chat"
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
          >
            <RotateCcw className="size-3.5" />
            New chat
          </button>
        )}
      </header>

      {/* Messages: scroll on their own, so the input stays in place */}
      <div ref={messagesRef} className="min-h-64 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {turns.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 py-6 text-center">
            <p className="max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
              Ask anything about the document. Answers are based only on its content, with sources.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void ask(s)}
                  className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 transition hover:border-brand-400 hover:text-brand-600 dark:border-white/10 dark:text-zinc-300 dark:hover:border-brand-400/60 dark:hover:text-brand-300"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, t) => (
          <Message key={t} turn={turn} total={index.chunks.length} />
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-zinc-200 p-3 dark:border-white/10">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={turns.length ? 'Ask a follow-up…' : 'Ask a question…'}
          maxLength={2000}
          className="min-w-0 flex-1 rounded-xl bg-zinc-100 px-4 py-2.5 text-sm outline-none placeholder:text-zinc-400 focus:ring-2 focus:ring-brand-500/30 dark:bg-white/5"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-label="Send"
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-white transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowUp className="size-5" />
        </button>
      </form>
    </section>
  );
}

function Message({ turn, total }: { turn: Turn; total: number }) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [openSource, setOpenSource] = useState<number | null>(null);
  const sourcesRef = useRef<HTMLDivElement>(null);

  /** Clicking a citation like [2] opens the sources with that one expanded. */
  function cite(n: number) {
    setSourcesOpen(true);
    setOpenSource(n);
    requestAnimationFrame(() => sourcesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }

  const markdownComponents: Components = {
    // Citations are turned into links to "#source-N" (see linkCitations below).
    a: ({ href, children }) => {
      const n = Number(href?.match(/^#source-(\d+)$/)?.[1]);
      return n ? (
        <button
          type="button"
          onClick={() => cite(n)}
          className="mx-px rounded bg-brand-500/15 px-1 align-baseline text-[0.7rem] font-semibold text-brand-700 no-underline hover:bg-brand-500/30 dark:text-brand-300"
        >
          {n}
        </button>
      ) : (
        <a href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      );
    },
    // Wide tables scroll sideways instead of breaking the bubble.
    table: ({ children }) => (
      <div className="overflow-x-auto">
        <table>{children}</table>
      </div>
    ),
  };

  return (
    <div className="space-y-2">
      {/* The question */}
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-4 py-2 text-sm whitespace-pre-wrap text-white">
          {turn.question}
        </p>
      </div>

      {/* The answer */}
      <div className="flex justify-start">
        <div className="max-w-[92%] min-w-0 rounded-2xl rounded-bl-md bg-zinc-100 px-4 py-3 dark:bg-white/5">
          {!turn.answer && turn.status !== 'error' && <TypingDots />}

          {turn.answer && (
            <div className="prose prose-zinc prose-sm dark:prose-invert prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5 prose-table:my-2 prose-th:px-2 prose-td:px-2 max-w-none">
              <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {linkCitations(turn.answer, turn.sources.length)}
              </Markdown>
            </div>
          )}

          {turn.status === 'error' && (
            <p className="flex items-start gap-2 text-sm text-red-600 dark:text-red-300">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              {turn.error}
            </p>
          )}

          {turn.sources.length > 0 && turn.status !== 'thinking' && (
            <div ref={sourcesRef} className="mt-2">
              <button
                type="button"
                onClick={() => setSourcesOpen((o) => !o)}
                className="flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                <FileText className="size-3.5" />
                {turn.searchQuery === null ? 'Based on the whole document' : `${turn.sources.length} sources`}
                <ChevronDown className={`size-3.5 transition ${sourcesOpen ? 'rotate-180' : ''}`} />
              </button>

              {sourcesOpen && (
                <div className="mt-2 space-y-1.5 border-t border-zinc-200 pt-2 dark:border-white/10">
                  {/* How the passages were chosen: useful to understand an answer */}
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {turn.searchQuery === null
                      ? `The document is short, so all ${total} passages were sent.`
                      : `Searched for "${turn.searchQuery}": the ${turn.sources.length} closest of ${total} passages (similarity score on the right).`}
                  </p>
                  {turn.sources.map((hit, i) => (
                    <SourceRow
                      key={hit.chunk}
                      n={i + 1}
                      hit={hit}
                      showScore={turn.searchQuery !== null}
                      open={openSource === i + 1}
                      onToggle={() => setOpenSource((o) => (o === i + 1 ? null : i + 1))}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SourceRow({
  n,
  hit,
  showScore,
  open,
  onToggle,
}: {
  n: number;
  hit: SearchHit;
  showScore: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-lg bg-white/60 dark:bg-black/20">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs">
        <span className="shrink-0 rounded bg-brand-500/15 px-1.5 font-semibold text-brand-700 dark:text-brand-300">{n}</span>
        <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-300">{hit.text.slice(0, 140)}</span>
        {showScore && <span className="shrink-0 text-zinc-400 tabular-nums">{hit.score.toFixed(2)}</span>}
      </button>
      {open && (
        <p className="px-2 pb-2 text-xs leading-relaxed whitespace-pre-line text-zinc-700 dark:text-zinc-300">{hit.text}</p>
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

/** The "…" animation while the answer is on its way. */
function TypingDots() {
  return (
    <span className="flex gap-1 py-1.5" aria-label="Thinking">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="size-1.5 animate-bounce rounded-full bg-zinc-400"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}
