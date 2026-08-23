import { parsePdf } from "@/lib/parsers/pdf";
import { parseExcel } from "@/lib/parsers/excel";
import { parseCsv } from "@/lib/parsers/csv";
import { parseDocx } from "@/lib/parsers/docx";
import { extractTextViaOpenAI, OcrError } from "@/lib/ai/extractText";
import { hasGeminiFallback, extractTextViaGemini } from "@/lib/ai/gemini";
import { withRetry } from "@/lib/retry";
import { logError } from "@/lib/logError";

// An OcrError explicitly marked non-retryable (e.g. the OpenAI account is
// out of credits) will fail identically on a retry — don't spend the
// job's time budget on a second attempt guaranteed to hit the same wall.
const isOcrRetryable = (err: unknown) => !(err instanceof OcrError) || err.retryable;

// OCR via OpenAI (with its own retry policy), then — only if OpenAI is
// fully exhausted AND GEMINI_API_KEY is configured — one Gemini attempt
// before giving up. Installs without Gemini configured behave byte-
// identically to before Gemini support existed: the original OpenAI error
// propagates unchanged. Gemini's own failure, if it also fails, is only
// logged — the OpenAI error is still the one thrown, since it's already
// the more diagnostic, already-classified message.
async function ocrWithFallback(buffer: Buffer, mimeType: string, label: string): Promise<string> {
  try {
    return await withRetry(() => extractTextViaOpenAI(buffer, mimeType), { retries: 1, label, isRetryable: isOcrRetryable });
  } catch (openAiErr) {
    if (!hasGeminiFallback()) throw openAiErr;
    try {
      console.log(`[parseFile] OpenAI OCR exhausted for ${label} — trying Gemini fallback`);
      return await extractTextViaGemini(buffer, mimeType);
    } catch (geminiErr) {
      logError(`[parseFile] Gemini OCR fallback also failed for ${label} — reporting the original OpenAI failure`, geminiErr);
      // Both providers failed — say so explicitly rather than always
      // showing the OpenAI-only message, which looked identical whether
      // Gemini wasn't configured, hadn't deployed yet, or was tried and
      // failed for its own (different) reason. Gemini's own error messages
      // are already short and safe to show (see gemini.ts — raw response
      // bodies are only ever logged, never thrown).
      const openAiMsg = openAiErr instanceof Error ? openAiErr.message : "OCR failed";
      const geminiMsg = geminiErr instanceof Error ? geminiErr.message : "unknown error";
      throw new Error(`${openAiMsg} (Backup AI provider also failed: ${geminiMsg})`);
    }
  }
}

// Shared by the multi-file RFQ upload flow and the Gmail attachment
// pipeline — one place that knows how to recognize and parse every
// supported format, so both entry points stay consistent (a format
// supported for upload is supported for email attachments too).
export type FileType = "pdf" | "excel" | "csv" | "docx" | "image" | "text";

export function detectFileType(filename: string, mime: string): FileType | null {
  const lower = filename.toLowerCase();
  if (mime.includes("pdf") || lower.endsWith(".pdf"))                          return "pdf";
  if (mime.includes("image") || /\.(jpe?g|png|webp|gif)$/.test(lower))         return "image";
  if (lower.endsWith(".docx") || mime.includes("wordprocessingml"))            return "docx";
  if (lower.endsWith(".csv") || mime.includes("text/csv"))                     return "csv";
  if (lower.endsWith(".txt") || mime.includes("text/plain"))                   return "text";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || mime.includes("spreadsheet") || mime.includes("excel")) return "excel";
  return null; // unrecognized — reject rather than guessing
}

export type ParsedFile = {
  name: string;
  type: FileType;
  buffer: Buffer;
  mime: string;
  text: string;
  error: string | null;
  usedOcr: boolean;
  truncated: boolean;
};

// Parses one file into text. Never throws — a failure is recorded on the
// result so a batch can continue with the remaining files ("continue
// processing remaining files/attachments if one fails").
export async function parseOneFile(name: string, type: FileType, buffer: Buffer, mime: string): Promise<ParsedFile> {
  const base = { name, type, buffer, mime, text: "", error: null as string | null, usedOcr: false, truncated: false };
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "(none)";
  console.log(`[parseOneFile] START PARSE file="${name}" type=${type} mime=${mime || "(none)"} ext=${ext} bytes=${buffer.length}`);
  try {
    switch (type) {
      case "pdf": {
        try {
          const { text, truncated } = await parsePdf(buffer);
          console.log(`[parseOneFile] PARSE COMPLETE file="${name}" truncated=${truncated}`);
          return { ...base, text, truncated };
        } catch (err) {
          // Malformed/scanned PDF — fall back to OpenAI, which handles any PDF
          // via base64. Vision/OCR calls are network-dependent and prone to
          // transient timeouts/429s, so retry once before giving up. Only
          // one retry (not two) deliberately — this runs per-file inside a
          // job with its own overall deadline (see JOB_DEADLINE_MS in the
          // process route), and OCR's own 45s-per-attempt timeout means two
          // retries alone could eat ~135s, more than the whole job's budget.
          console.log(`[parseOneFile] PDF parser failed for "${name}" (${err instanceof Error ? err.message : "unknown error"}), START OCR fallback`);
          const text = await ocrWithFallback(buffer, "application/pdf", `PDF OCR for "${name}"`);
          console.log(`[parseOneFile] OCR COMPLETE file="${name}"`);
          return { ...base, text, usedOcr: true };
        }
      }
      case "excel": { const text = parseExcel(buffer); console.log(`[parseOneFile] PARSE COMPLETE file="${name}"`); return { ...base, text }; }
      case "csv":   { const text = parseCsv(buffer);   console.log(`[parseOneFile] PARSE COMPLETE file="${name}"`); return { ...base, text }; }
      case "docx":  { const text = await parseDocx(buffer); console.log(`[parseOneFile] PARSE COMPLETE file="${name}"`); return { ...base, text }; }
      case "text":  { const text = buffer.toString("utf-8"); console.log(`[parseOneFile] PARSE COMPLETE file="${name}"`); return { ...base, text }; }
      case "image": {
        // See the PDF-fallback comment above — one retry, not two, to stay
        // within the process job's overall deadline.
        console.log(`[parseOneFile] START OCR file="${name}"`);
        const text = await ocrWithFallback(buffer, mime || "image/jpeg", `image OCR for "${name}"`);
        console.log(`[parseOneFile] OCR COMPLETE file="${name}"`);
        return { ...base, text, usedOcr: true };
      }
      default: {
        // Unreachable via the normal fetch/upload paths (detectFileType is
        // checked before a rfq_files row is ever created — see
        // src/lib/email/sync.ts and api/rfqs/upload/route.ts), but a
        // stored file_type of unknown/corrupted provenance (e.g. a row from
        // before some migration) must still fail gracefully here rather
        // than silently falling through with no return value.
        console.log(`[parseOneFile] unsupported file type "${type}" for "${name}"`);
        return { ...base, error: `Unsupported file type for "${name}"` };
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to parse this file";
    console.log(`[parseOneFile] PARSE FAILED file="${name}": ${msg}`);
    return { ...base, error: `Could not read "${name}": ${msg}` };
  }
}
