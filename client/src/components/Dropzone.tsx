import { useState, type DragEvent } from 'react';
import { CloudUpload, FileText, X } from 'lucide-react';

export const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'];
// Must match MAX_FILE_BYTES in server/src/index.ts (base64 + Vercel's 4.5 MB body cap).
export const MAX_FILE_BYTES = 3 * 1024 * 1024;

interface DropzoneProps {
  file: File | null;
  onFileChange: (file: File | null) => void;
  disabled?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function Dropzone({ file, onFileChange, disabled = false }: DropzoneProps) {
  const [dragging, setDragging] = useState(false);

  function handleDrop(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    setDragging(false);
    if (!disabled) onFileChange(e.dataTransfer.files[0] ?? null);
  }

  // A file is selected: show it as a "chip" with a remove button.
  if (file) {
    return (
      <div className="flex items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
        <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
          <FileText className="size-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-zinc-900 dark:text-white">{file.name}</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{formatBytes(file.size)}</p>
        </div>
        <button
          type="button"
          onClick={() => onFileChange(null)}
          disabled={disabled}
          aria-label="Remove file"
          className="grid size-9 place-items-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-40 dark:hover:bg-white/10 dark:hover:text-white"
        >
          <X className="size-5" />
        </button>
      </div>
    );
  }

  // No file yet: the big drop area. A <label> around the hidden input makes the whole area clickable.
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`group flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
        dragging
          ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10'
          : 'border-zinc-300 bg-white/60 hover:border-brand-400 hover:bg-white dark:border-white/15 dark:bg-white/[0.03] dark:hover:border-brand-400/60 dark:hover:bg-white/5'
      }`}
    >
      <input
        type="file"
        accept={ACCEPTED_EXTENSIONS.join(',')}
        className="hidden"
        onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
      />
      <div className="grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-600 transition group-hover:scale-105 dark:bg-brand-500/15 dark:text-brand-300">
        <CloudUpload className="size-7" />
      </div>
      <div>
        <p className="font-medium text-zinc-900 dark:text-white">
          Drop your document here or <span className="text-brand-600 dark:text-brand-400">browse</span>
        </p>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">PDF, DOCX, TXT or MD · up to 3 MB</p>
      </div>
    </label>
  );
}
