import { useState } from 'react';

const ACCEPT = '.pdf,.docx,.txt,.md';

export default function App() {
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  function pickFile(f) {
    if (!f) return;
    setFile(f);
    setResult(null);
    setError('');
  }

  async function summarize() {
    setLoading(true);
    setError('');
    setResult(null);

    // Files are sent as multipart/form-data; the server reads the "file" field with multer.
    const body = new FormData();
    body.append('file', file);

    try {
      const res = await fetch('/api/summarize', { method: 'POST', body });
      // If Express is down, Vite's proxy answers with an empty body (not JSON).
      const data = await res.json().catch(() => {
        throw new Error(`Server returned no data (HTTP ${res.status}). Is the backend running? (cd server && npm run dev)`);
      });
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>DocDrop</h1>
      <p className="muted">Upload a PDF, DOCX, TXT or MD file and get an AI summary.</p>

      <label
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pickFile(e.dataTransfer.files[0]);
        }}
      >
        <input type="file" accept={ACCEPT} hidden onChange={(e) => pickFile(e.target.files[0])} />
        {file ? <strong>{file.name}</strong> : 'Drop a file here or click to choose'}
      </label>

      <button onClick={summarize} disabled={!file || loading}>
        {loading ? 'Summarizing…' : 'Summarize'}
      </button>

      {error && <p className="error">{error}</p>}

      {result && (
        <section className="result">
          <h2>Summary</h2>
          <div className="summary">{result.summary}</div>
          <p className="muted stats">
            {result.stats.characters.toLocaleString()} chars (~{result.stats.approxTokens.toLocaleString()} tokens) ·{' '}
            {result.stats.chunks} chunk(s) · {result.stats.model} · {(result.stats.ms / 1000).toFixed(1)}s
          </p>
        </section>
      )}
    </main>
  );
}
