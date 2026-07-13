import { parsePdf } from "@/lib/parsers/pdf";
import { parseExcel } from "@/lib/parsers/excel";
import { parseCsv } from "@/lib/parsers/csv";
import { parseDocx } from "@/lib/parsers/docx";
import { extractTextViaOpenAI } from "@/lib/ai/extractText";
import { withRetry } from "@/lib/retry";

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
};

// Parses one file into text. Never throws — a failure is recorded on the
// result so a batch can continue with the remaining files ("continue
// processing remaining files/attachments if one fails").
export async function parseOneFile(name: string, type: FileType, buffer: Buffer, mime: string): Promise<ParsedFile> {
  const base = { name, type, buffer, mime, text: "", error: null as string | null, usedOcr: false };
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "(none)";
  console.log(`[parseOneFile] START PARSE file="${name}" type=${type} mime=${mime || "(none)"} ext=${ext} bytes=${buffer.length}`);
  try {
    switch (type) {
      case "pdf": {
        try {
          const text = await parsePdf(buffer);
          console.log(`[parseOneFile] PARSE COMPLETE file="${name}"`);
          return { ...base, text };
        } catch (err) {
          // Malformed/scanned PDF — fall back to OpenAI, which handles any PDF
          // via base64. Vision/OCR calls are network-dependent and prone to
          // transient timeouts/429s, so retry once before giving up. Only
          // one retry (not two) deliberately — this runs per-file inside a
          // job with its own overall deadline (see JOB_DEADLINE_MS in the
          // process route), and OCR's own 45s-per-attempt timeout means two
          // retries alone could eat ~135s, more than the whole job's budget.
          console.log(`[parseOneFile] PDF parser failed for "${name}" (${err instanceof Error ? err.message : "unknown error"}), START OCR fallback`);
          const text = await withRetry(() => extractTextViaOpenAI(buffer, "application/pdf"), { retries: 1, label: `PDF OCR for "${name}"` });
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
        const text = await withRetry(() => extractTextViaOpenAI(buffer, mime || "image/jpeg"), { retries: 1, label: `image OCR for "${name}"` });
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
