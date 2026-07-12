import { parsePdf } from "@/lib/parsers/pdf";
import { parseExcel } from "@/lib/parsers/excel";
import { parseCsv } from "@/lib/parsers/csv";
import { parseDocx } from "@/lib/parsers/docx";
import { extractTextViaOpenAI } from "@/lib/ai/extractText";

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
  try {
    switch (type) {
      case "pdf": {
        try {
          return { ...base, text: await parsePdf(buffer) };
        } catch {
          // Malformed/scanned PDF — fall back to OpenAI, which handles any PDF via base64
          return { ...base, text: await extractTextViaOpenAI(buffer, "application/pdf"), usedOcr: true };
        }
      }
      case "excel": return { ...base, text: parseExcel(buffer) };
      case "csv":   return { ...base, text: parseCsv(buffer) };
      case "docx":  return { ...base, text: await parseDocx(buffer) };
      case "text":  return { ...base, text: buffer.toString("utf-8") };
      case "image": return { ...base, text: await extractTextViaOpenAI(buffer, mime || "image/jpeg"), usedOcr: true };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to parse this file";
    return { ...base, error: `Could not read "${name}": ${msg}` };
  }
}
