// Step 1 of the pipeline: turn an uploaded file (binary) into plain text.
// LLMs only understand text, so every document format needs a parser.
import path from 'node:path';
import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';

export const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'];

// Errors caused by the user's input (returned as HTTP 400 instead of 500).
export class UserError extends Error {}

// The uploaded file: its original name (for the extension) and its bytes.
export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
}

export async function extractTextFromFile(file: UploadedFile): Promise<string> {
  const ext = path.extname(file.originalname).toLowerCase();
  let text: string;

  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new UserError(`Unsupported file type "${ext}". Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`);
  }

  try {
    if (ext === '.pdf') {
      const pdf = await getDocumentProxy(new Uint8Array(file.buffer));
      ({ text } = await extractText(pdf, { mergePages: true }));
    } else if (ext === '.docx') {
      ({ value: text } = await mammoth.extractRawText({ buffer: file.buffer }));
    } else {
      text = file.buffer.toString('utf8');
    }
  } catch (err) {
    // A broken or password-protected file is the user's input, not a server bug.
    console.warn('[extract] could not parse file:', err);
    throw new UserError(`Could not read this ${ext.slice(1).toUpperCase()} file. It may be damaged or password-protected.`);
  }

  // Collapse noisy whitespace that PDF/DOCX parsers often produce.
  text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  if (!text) {
    // Scanned PDFs are pictures of text; reading them would need OCR.
    throw new UserError('No text found in the document (is it a scanned PDF?)');
  }
  return text;
}
