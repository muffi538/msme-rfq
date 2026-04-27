import * as XLSX from "xlsx";

export function parseExcel(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: "buffer" });
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
