import mammoth from "mammoth";
import { withTimeout } from "@/lib/timeout";

const DOCX_PARSE_TIMEOUT_MS = 20_000;

export async function parseDocx(buffer: Buffer): Promise<string> {
  const { value } = await withTimeout(mammoth.extractRawText({ buffer }), DOCX_PARSE_TIMEOUT_MS, "DOCX parsing");
  return value;
}
