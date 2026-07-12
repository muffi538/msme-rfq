import * as XLSX from "xlsx";

// Shared by parseExcel and the CSV parser — every sheet, every row, flattened
// to tab-separated text lines for the LLM extraction step.
export function flattenWorkbookToText(workbook: XLSX.WorkBook): string {
  const lines: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    // Convert sheet to array of arrays (rows)
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    for (const row of rows) {
      const line = (row as string[]).map(String).join("\t").trim();
      if (line) lines.push(line);
    }
  }

  return lines.join("\n");
}

export function parseExcel(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  return flattenWorkbookToText(workbook);
}
