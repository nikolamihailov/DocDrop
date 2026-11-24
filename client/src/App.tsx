import { useEffect, useState } from 'react';
import { CircleAlert, FileText, Sparkles } from 'lucide-react';
import Dropzone, { ACCEPTED_EXTENSIONS, MAX_FILE_BYTES } from './components/Dropzone';
import SummaryCard, { SummarySkeleton } from './components/SummaryCard';
import ProgressCard, { shortModel } from './components/ProgressCard';
import ChatPanel from './components/ChatPanel';
import { getHealth, summarizeFile } from './api';
import { loadIndex, type LoadedIndex } from './rag';
import type { ProgressStage, SummarizeResponse } from './types';

// A "discriminated union": `status` tells TypeScript which other fields exist.
// e.g. `result` is only accessible when status === 'success'.
type RequestState =
  | { status: 'idle' }
  | { status: 'loading'; progress: ProgressStage | null }
  // `index`: the document's passages + vectors, unpacked for searching (null = no Q&A)
  | { status: 'success'; result: SummarizeResponse; index: LoadedIndex | null }
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
      const index = result.index ? loadIndex(result.index) : null;
      setState({ status: 'success', result, index });

      // For learning: the index is also explorable in the browser console.
      // Try: docdropIndex.chunks[0], or docdropIndex.vectors.slice(0, docdropIndex.dimensions)
      if (index) {
        (window as unknown as { docdropIndex: LoadedIndex }).docdropIndex = index;
        console.info(
          `[rag] ${index.chunks.length} passages × ${index.dimensions} numbers (${index.model}). Inspect it as window.docdropIndex`,
        );
      }
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  const loading = state.status === 'loading';
  // The document's Q&A index, if the last summary produced one: then the chat is shown.
  const chatIndex = state.status === 'success' ? state.index : null;

  return (
    <div className="relative min-h-screen overflow-hidden bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
      {/* Soft gradient glow behind the content. `fixed inset-0` pins it to the whole window,
          so it covers the full page height and stays put while you scroll. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[480px] w-[900px] -translate-x-1/2 rounded-full bg-gradient-to-br from-brand-400/30 via-rose-400/20 to-orange-300/15 blur-3xl dark:from-brand-600/25 dark:via-rose-600/15 dark:to-orange-500/10" />
        <div className="absolute -bottom-48 -left-32 h-[420px] w-[700px] rounded-full bg-gradient-to-tr from-brand-400/20 to-rose-300/10 blur-3xl dark:from-brand-700/20 dark:to-rose-700/10" />
        <div className="absolute -right-40 -bottom-40 h-[380px] w-[600px] rounded-full bg-gradient-to-tl from-orange-300/15 to-brand-400/10 blur-3xl dark:from-orange-600/10 dark:to-brand-700/15" />
      </div>

      {/* One column while uploading; two columns (document | chat) on big screens once there's a chat. */}
      <div className={`relative mx-auto px-4 pt-8 pb-20 sm:px-6 ${chatIndex ? 'max-w-7xl lg:pb-6' : 'max-w-2xl'}`}>
        <nav className="flex items-center justify-between gap-4">
          <div className="flex shrink-0 items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-orange-600 text-white shadow-lg shadow-brand-500/30">
              <FileText className="size-5" />
            </div>
            <span className="text-lg font-semibold tracking-tight">DocDrop</span>
          </div>
          <BackendBadge backend={backend} />
        </nav>

        {/* The big title only while there's nothing to show yet: afterwards it's just scrolling. */}
        {state.status !== 'success' ? (
          <header className="mt-16 mb-10 text-center">
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Understand any document{' '}
              <span className="bg-gradient-to-r from-brand-500 to-orange-500 bg-clip-text text-transparent">
                in seconds
              </span>
            </h1>
            <p className="mx-auto mt-4 max-w-md text-zinc-600 dark:text-zinc-400">
              Upload a PDF, Word document or text file to get a structured summary, then ask questions and get answers
              with sources from the document.
            </p>
          </header>
        ) : (
          <div className="mt-8" />
        )}

        {/* Two-column mode on big screens: both columns get the same fixed height (the screen
            minus the top bar, capped at 56rem so they don't tower over big monitors).
            The summary and the chat each scroll inside their own card. */}
        <div className={chatIndex ? 'grid gap-6 lg:h-[min(calc(100vh-10rem),56rem)] lg:min-h-120 lg:grid-cols-2' : ''}>
          {/* Left (or only) column: upload + summary */}
          <div className={`min-w-0 space-y-4 ${chatIndex ? 'lg:flex lg:min-h-0 lg:flex-col' : ''}`}>
            <div className="shrink-0 space-y-4">
              <Dropzone file={file} onFileChange={handleFileChange} disabled={loading} />

              <button
                type="button"
                onClick={handleSummarize}
                disabled={!file || loading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-3 font-medium text-white shadow-lg shadow-brand-600/25 transition hover:bg-brand-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
              >
                {/* No spinner here: while loading, the progress card below shows what's happening. */}
                <Sparkles className="size-5" />
                {loading ? 'Summarizing…' : 'Summarize'}
              </button>

              {state.status === 'error' && (
                <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                  <CircleAlert className="mt-0.5 size-5 shrink-0" />
                  <p>{state.message}</p>
                </div>
              )}
            </div>

            {state.status === 'loading' && (
              <div className="space-y-4 pt-6">
                <ProgressCard progress={state.progress} />
                <SummarySkeleton />
              </div>
            )}
            {state.status === 'success' && (
              // In two-column mode this fills the rest of the column; the card scrolls inside.
              <div className={`pt-2 ${chatIndex ? 'lg:min-h-0 lg:flex-1' : ''}`}>
                <SummaryCard result={state.result} fill={!!chatIndex} />
              </div>
            )}
          </div>

          {/* Right column: the chat, exactly as tall as the left column */}
          {chatIndex && (
            <div className="min-w-0 lg:h-full lg:min-h-0">
              <ChatPanel key={state.status === 'success' ? state.result.fileName : ''} index={chatIndex} />
            </div>
          )}
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
