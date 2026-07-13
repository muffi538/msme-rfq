import { withTimeout } from "@/lib/timeout";

// pdf-parse v1 requires CJS require in Next.js (no default ESM export)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as (buf: Buffer, opts?: { max?: number }) => Promise<{ text: string }>;

// Root cause of RFQs hanging indefinitely at the "Parsing" stage: pdf-parse
// v1.1.1 bundles a pinned, very old PDF.js build (v1.10.100, see
// node_modules/pdf-parse/lib/pdf-parse.js) and by default renders EVERY
// page of the document one at a time with no cap and no timeout of its
// own. A many-page or pathologically-structured PDF can take an unbounded
// amount of wall-clock time inside that per-page loop, with nothing in the
// codebase bounding this specific call — the only backstop was the whole
// job's shared ~100s deadline, which meant a single bad PDF could silently
// eat the entire budget before anything failed. Both bounded here: a hard
// timeout (matches "20s" from the debugging requirements this fixes), and
// a page cap so a legitimately huge document fails fast with a specific,
// diagnosable reason instead of quietly stalling.
const PDF_PARSE_TIMEOUT_MS = 20_000;
const PDF_MAX_PAGES = 50;

export async function parsePdf(buffer: Buffer): Promise<string> {
  const data = await withTimeout(pdfParse(buffer, { max: PDF_MAX_PAGES }), PDF_PARSE_TIMEOUT_MS, "PDF parsing");
  return data.text;
}
