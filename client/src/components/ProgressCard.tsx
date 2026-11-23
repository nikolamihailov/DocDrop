import { useEffect, useRef, useState } from 'react';
import { Hourglass, LoaderCircle } from 'lucide-react';
import type { ProgressStage } from '../types';

interface ProgressCardProps {
  /** Latest update from the server; null until the first one arrives (still uploading). */
  progress: ProgressStage | null;
}

/** "openai/gpt-oss-20b" -> "gpt-oss-20b", "models/gemini-x" -> "gemini-x" */
export function shortModel(model: string): string {
  return model.split('/').pop() ?? model;
}

function describe(progress: ProgressStage | null): { label: string; percent: number | null } {
  if (!progress) return { label: 'Uploading…', percent: 3 };
  switch (progress.stage) {
    case 'extracting':
      return { label: 'Reading the document…', percent: 8 };
    case 'summarizing':
      return progress.total === 1
        ? { label: `Summarizing with ${shortModel(progress.model)}…`, percent: 40 }
        : {
            label: `Summarizing part ${progress.part} of ${progress.total}…`,
            percent: 10 + (80 * (progress.part - 1)) / progress.total,
          };
    case 'combining':
      return { label: 'Combining the parts into one summary…', percent: 92 };
    case 'fallback':
      return { label: `Long-document model unavailable, switching to ${shortModel(progress.model)}…`, percent: 10 };
    case 'waiting':
      // Keep the bar where it was; only the label changes.
      return { label: `AI provider is busy (free tier), retrying in ${progress.seconds}s…`, percent: null };
  }
}

export default function ProgressCard({ progress }: ProgressCardProps) {
  const { label, percent } = describe(progress);
  const waiting = progress?.stage === 'waiting';

  // Remember the last real percentage so the bar doesn't jump back while waiting.
  const lastPercent = useRef(3);
  if (percent !== null) lastPercent.current = percent;

  // Elapsed time, so long documents don't look frozen.
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <section
      aria-live="polite"
      className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl shadow-zinc-900/5 dark:border-white/10 dark:bg-zinc-900/60 dark:shadow-black/20"
    >
      <div className="flex items-center gap-3">
        {waiting ? (
          <Hourglass className="size-5 shrink-0 text-amber-500" />
        ) : (
          <LoaderCircle className="size-5 shrink-0 animate-spin text-brand-500" />
        )}
        <p className="flex-1 font-medium text-zinc-800 dark:text-zinc-100">{label}</p>
        <span className="text-sm text-zinc-500 tabular-nums dark:text-zinc-400">{seconds}s</span>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-white/10">
        <div
          className={`h-full rounded-full transition-[width] duration-700 ease-out ${
            waiting ? 'bg-amber-500' : 'bg-gradient-to-r from-brand-500 to-orange-500'
          }`}
          style={{ width: `${lastPercent.current}%` }}
        />
      </div>
    </section>
  );
}
