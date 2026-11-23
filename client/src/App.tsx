import { useEffect, useState } from 'react';
import { CircleAlert, FileText, LoaderCircle, Sparkles } from 'lucide-react';
import Dropzone, { ACCEPTED_EXTENSIONS, MAX_FILE_BYTES } from './components/Dropzone';
import SummaryCard, { SummarySkeleton } from './components/SummaryCard';
import ProgressCard, { shortModel } from './components/ProgressCard';
import { getHealth, summarizeFile } from './api';
import type { ProgressStage, SummarizeResponse } from './types';

// A "discriminated union": `status` tells TypeScript which other fields exist.
// e.g. `result` is only accessible when status === 'success'.
type RequestState =
  | { status: 'idle' }
  | { status: 'loading'; progress: ProgressStage | null }
  | { status: 'success'; result: SummarizeResponse }
  | { status: 'error'; message: string };

// null = still checking, string = connected (model name), false = offline
type Backend = string | false | null;

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<RequestState>({ status: 'idle' });
  const [backend, setBackend] = useState<Backend>(null);

  useEffect(() => {
    getHealth()
      .then((h) => {
        const models = [h.model, h.largeModel].filter((m): m is string => !!m).map(shortModel);
        setBackend(models.length ? models.join(' + ') : 'no model set');
      })
      .catch(() => setBackend(false));
  }, []);

  function handleFileChange(next: File | null) {
    if (next && !ACCEPTED_EXTENSIONS.some((ext) => next.name.toLowerCase().endsWith(ext))) {
      setState({ status: 'error', message: `Unsupported file. Please choose: ${ACCEPTED_EXTENSIONS.join(', ')}` });
      return;
    }
    if (next && next.size > MAX_FILE_BYTES) {
      setState({ status: 'error', message: 'File is too large. The maximum size is 3 MB.' });
      return;
    }
    setFile(next);
    setState({ status: 'idle' });
  }

  async function handleSummarize() {
    if (!file) return;
    setState({ status: 'loading', progress: null });
    try {
      const result = await summarizeFile(file, (progress) => setState({ status: 'loading', progress }));
      setState({ status: 'success', result });
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  const loading = state.status === 'loading';

  return (
    <div className="relative min-h-screen overflow-hidden bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
      {/* Soft gradient glow behind the content */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[900px] -translate-x-1/2 rounded-full bg-gradient-to-br from-brand-400/30 via-rose-400/20 to-orange-300/15 blur-3xl dark:from-brand-600/25 dark:via-rose-600/15 dark:to-orange-500/10"
      />

      <div className="relative mx-auto max-w-2xl px-4 pt-8 pb-20 sm:px-6">
        <nav className="flex items-center justify-between gap-4">
          <div className="flex shrink-0 items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-orange-600 text-white shadow-lg shadow-brand-500/30">
              <FileText className="size-5" />
            </div>
            <span className="text-lg font-semibold tracking-tight">DocDrop</span>
          </div>
          <BackendBadge backend={backend} />
        </nav>

        <header className="mt-16 mb-10 text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Summarize any document{' '}
            <span className="bg-gradient-to-r from-brand-500 to-orange-500 bg-clip-text text-transparent">in seconds</span>
          </h1>
          <p className="mx-auto mt-4 max-w-md text-zinc-600 dark:text-zinc-400">
            Upload a PDF, Word document or text file and get a short, structured summary powered by an LLM.
          </p>
        </header>

        <div className="space-y-4">
          <Dropzone file={file} onFileChange={handleFileChange} disabled={loading} />

          <button
            type="button"
            onClick={handleSummarize}
            disabled={!file || loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-3 font-medium text-white shadow-lg shadow-brand-600/25 transition hover:bg-brand-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          >
            {loading ? <LoaderCircle className="size-5 animate-spin" /> : <Sparkles className="size-5" />}
            {loading ? 'Summarizing…' : 'Summarize'}
          </button>

          {state.status === 'error' && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              <CircleAlert className="mt-0.5 size-5 shrink-0" />
              <p>{state.message}</p>
            </div>
          )}
        </div>

        <div className="mt-10">
          {state.status === 'loading' && (
            <div className="space-y-4">
              <ProgressCard progress={state.progress} />
              <SummarySkeleton />
            </div>
          )}
          {state.status === 'success' && <SummaryCard result={state.result} />}
        </div>
      </div>
    </div>
  );
}

function BackendBadge({ backend }: { backend: Backend }) {
  const [dot, label] =
    backend === null
      ? ['bg-zinc-400', 'Connecting…']
      : backend === false
        ? ['bg-red-500', 'Backend offline']
        : ['bg-emerald-500', backend];

  return (
    <span className="flex min-w-0 items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs font-medium text-zinc-600 backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
      <span className={`size-2 shrink-0 rounded-full ${dot}`} />
      <span className="truncate" title={label}>
        {label}
      </span>
    </span>
  );
}
