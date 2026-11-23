import { useState } from 'react';
import Markdown from 'react-markdown';
import { Check, Copy } from 'lucide-react';
import type { SummarizeResponse } from '../types';

interface SummaryCardProps {
  result: SummarizeResponse;
}

export default function SummaryCard({ result }: SummaryCardProps) {
  const [copied, setCopied] = useState(false);
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
    <section className={cardClass}>
      <header className="flex items-start justify-between gap-4 border-b border-zinc-200 px-6 py-4 dark:border-white/10">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wider text-brand-600 uppercase dark:text-brand-400">Summary</p>
          <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">{result.fileName}</p>
        </div>
        <button
          type="button"
          onClick={copy}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/10"
        >
          {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </header>

      {/* `prose` (typography plugin) styles the Markdown the model returns. */}
      <div className="prose prose-zinc dark:prose-invert prose-headings:font-semibold prose-headings:tracking-tight prose-h2:mt-6 prose-h2:mb-2 prose-h2:text-lg first:prose-h2:mt-0 prose-li:my-1 prose-li:marker:text-brand-500 max-w-none px-6 py-5">
        <Markdown>{result.summary}</Markdown>
      </div>

      <footer className="flex flex-wrap gap-2 border-t border-zinc-200 px-6 py-3 dark:border-white/10">
        {pills.map((pill) => (
          <span
            key={pill}
            className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:bg-white/10 dark:text-zinc-300"
          >
            {pill}
          </span>
        ))}
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
