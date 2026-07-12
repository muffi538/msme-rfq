import * as XLSX from "xlsx";
import { flattenWorkbookToText } from "@/lib/parsers/excel";

// Real CSV parsing (quoted fields, embedded commas) instead of treating the
// file as opaque plain text — reuses xlsx's CSV codepath (type: "string"
// makes SheetJS parse it as delimited text) and the same row-flattening
// logic as the Excel parser, so both feed the LLM in an identical shape.
export function parseCsv(buffer: Buffer): string {
  const text = buffer.toString("utf-8");
  const workbook = XLSX.read(text, { type: "string" });
  return flattenWorkbookToText(workbook);
}
