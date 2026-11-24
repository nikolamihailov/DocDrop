import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, ChevronDown, Copy, Search } from 'lucide-react';
import type { SummarizeResponse } from '../types';

interface SummaryCardProps {
  result: SummarizeResponse;
  /**
   * Two-column layout on big screens: fill the parent's height, keep header and footer
   * in place, and scroll only the summary text in between.
   */
  fill?: boolean;
}

export default function SummaryCard({ result, fill = false }: SummaryCardProps) {
  const [copied, setCopied] = useState(false);
  // Small screens only: the summary can be folded away so the chat below is closer.
  // ("hidden lg:block" below = hidden on small screens, always shown on big ones.)
  const [collapsed, setCollapsed] = useState(false);
  const { stats } = result;

  async function copy() {
    await navigator.clipboard.writeText(result.summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const pills = [
    stats.model,
    `${(stats.ms / 1000).toFixed(1)}s`,
    `~${stats.approxTokens.toLocaleString()} tokens`,
    `${stats.chunks} chunk${stats.chunks === 1 ? '' : 's'}`,
    // Actual summary length vs. the budget it was given (see server/src/summarize.ts).
    `${result.summary.split(/\s+/).filter(Boolean).length} / ~${stats.targetWords} words`,
  ];

  return (
    <section className={`${cardClass} ${fill ? 'lg:flex lg:h-full lg:flex-col' : ''}`}>
      <header
        className={`flex shrink-0 items-start justify-between gap-4 border-zinc-200 px-6 py-4 dark:border-white/10 ${collapsed ? 'lg:border-b' : 'border-b'}`}
      >
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wider text-brand-600 uppercase dark:text-brand-400">Summary</p>
          <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">{result.fileName}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={copy}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/10"
          >
            {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            className="flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 lg:hidden dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/10"
          >
            {collapsed ? 'Show' : 'Hide'}
            <ChevronDown className={`size-4 transition ${collapsed ? '' : 'rotate-180'}`} />
          </button>
        </div>
      </header>

      {/* `prose` (typography plugin) styles the Markdown the model returns. */}
      <div
        className={`prose prose-zinc dark:prose-invert prose-headings:font-semibold prose-headings:tracking-tight prose-h2:mt-6 prose-h2:mb-2 prose-h2:text-lg first:prose-h2:mt-0 prose-li:my-1 prose-li:marker:text-brand-500 max-w-none px-6 py-5 ${fill ? 'lg:min-h-0 lg:flex-1 lg:overflow-y-auto' : ''} ${collapsed ? 'hidden lg:block' : ''}`}
      >
        {/* remark-gfm adds GitHub-flavored Markdown: tables, strikethrough, task lists */}
        <Markdown remarkPlugins={[remarkGfm]}>{result.summary}</Markdown>
      </div>

      <footer
        className={`shrink-0 flex-wrap gap-2 border-t border-zinc-200 px-6 py-3 dark:border-white/10 ${collapsed ? 'hidden lg:flex' : 'flex'}`}
      >
        {pills.map((pill) => (
          <span
            key={pill}
            className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:bg-white/10 dark:text-zinc-300"
          >
            {pill}
          </span>
        ))}
        {/* RAG status: was the document indexed for questions? (see server/src/rag.ts) */}
        {result.index ? (
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            <Search className="size-3" />
            {result.index.chunks.length} passages indexed for Q&A
          </span>
        ) : (
          <span
            title={result.indexError ?? undefined}
            className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300"
          >
            Q&A unavailable
          </span>
        )}
      </footer>
    </section>
  );
}

/** Placeholder shown while the LLM is working. */
export function SummarySkeleton() {
  return (
    <section className={`${cardClass} animate-pulse space-y-4 p-6`}>
      {['w-1/4', 'w-full', 'w-5/6', 'w-1/3', 'w-2/3', 'w-3/4', 'w-1/2'].map((width, i) => (
        <div key={i} className={`h-3.5 rounded-full bg-zinc-200 dark:bg-white/10 ${width}`} />
      ))}
    </section>
  );
}

const cardClass =
  'overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl shadow-zinc-900/5 dark:border-white/10 dark:bg-zinc-900/60 dark:shadow-black/20';
