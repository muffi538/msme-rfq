import * as XLSX from "xlsx";

// Shared by parseExcel and the CSV parser — every sheet, every row, flattened
// to tab-separated text lines for the LLM extraction step.
export function flattenWorkbookToText(workbook: XLSX.WorkBook): string {
  const lines: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    // Convert sheet to array of arrays (rows)
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    // sheet_to_json only puts a value in the merge range's TOP-LEFT cell —
    // every other cell in a merged range comes back "". Real supplier
    // spreadsheets commonly merge a category/heading column down several
    // item rows (confirmed with a real test file: a "Category" column
    // merged across 3 rows), so without this, every row but the first in
    // that merge silently lost its category once flattened to text.
    // Forward-fill each merge range with its top-left value first.
    for (const merge of sheet["!merges"] ?? []) {
      const topLeft = rows[merge.s.r]?.[merge.s.c];
      if (topLeft === undefined || topLeft === "") continue;
      for (let r = merge.s.r; r <= merge.e.r; r++) {
        if (!rows[r]) continue;
        for (let c = merge.s.c; c <= merge.e.c; c++) rows[r][c] = topLeft;
      }
    }

    for (const row of rows) {
      // Sanitize each CELL before joining, not just the finished line —
      // a cell containing an embedded newline (Alt+Enter line-wrapping
      // inside an Excel cell is common in real supplier price lists) or a
      // literal tab would otherwise inject a raw \n/\t into the middle of
      // this "one row = one line" text, silently splitting that row's
      // data across two lines and detaching its serial number from its
      // own description. Collapsing internal whitespace runs to a single
      // space keeps the row structure intact no matter what a cell
      // contains. Confirmed against a real supplier file where 9 of 43
      // rows had this exact corruption before this fix.
      const line = row.map((cell) => String(cell).replace(/\s+/g, " ").trim()).join("\t").trim();
      if (line) lines.push(line);
    }
  }

  return lines.join("\n");
}

// Real signature bytes, not guessed: a genuine .xlsx is a ZIP container
// (PK.. — 0x504b0304 is the standard local-file-header signature; 0x504b0506/
// 0x504b0708 cover an empty or spanned archive), and a genuine legacy .xls
// is an OLE2 compound file (D0CF11E0A1B11AE1). Confirmed with a real test:
// feeding plain garbage text into XLSX.read(buf, {type:"buffer"}) does NOT
// throw — SheetJS's format auto-detection falls back to treating
// unrecognized bytes as delimited text and happily "parses" nonsense into
// fake rows. Since detectFileType already routed this buffer here because
// its filename/mime SAID .xlsx/.xls, silently accepting non-Excel bytes
// would feed garbage into AI extraction as if it were real supplier data
// instead of failing with a clear, honest error.
const ZIP_SIGNATURES = [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x50, 0x4b, 0x07, 0x08]];
const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function looksLikeExcelFile(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  const matches = (sig: number[]) => sig.every((b, i) => buffer[i] === b);
  return ZIP_SIGNATURES.some(matches) || matches(OLE2_SIGNATURE);
}

// Deliberately synchronous (matches XLSX.read's own synchronous API) — a
// Promise-based timeout wrapper here would be cosmetic, not real: a
// genuinely blocking synchronous call can't be preempted by a timer, since
// nothing else (including the timer callback) can run until this function
// returns control to the event loop either way. In practice XLSX.read is
// fast even for large sheets; parseOneFile's own try/catch still catches
// any throw from a malformed workbook.
export function parseExcel(buffer: Buffer): string {
  if (!looksLikeExcelFile(buffer)) {
    throw new Error("This doesn't look like a valid Excel file — it may be corrupted, password-protected, or a different file type saved with an Excel extension.");
  }
  const workbook = XLSX.read(buffer, { type: "buffer" });
  return flattenWorkbookToText(workbook);
}
