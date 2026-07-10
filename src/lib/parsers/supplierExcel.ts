import * as XLSX from "xlsx";

export type ParsedSupplier = {
  name: string;
  contact: string;
  email: string;
  phone: string;
  gst: string;
  address: string;
};

const NAME_HEADERS    = ["supplier", "supplier name", "party name", "ledger name", "name", "vendor", "vendor name", "particulars", "party"];
const CONTACT_HEADERS = ["contact", "contact person", "contact name"];
const EMAIL_HEADERS   = ["email", "email id", "e-mail", "email address"];
const PHONE_HEADERS   = ["phone", "mobile", "mobile number", "contact number", "whatsapp", "whatsapp number", "phone number"];
const GST_HEADERS     = ["gst", "gstin", "gst no", "gst number"];
const ADDRESS_HEADERS = ["address"];

function normalize(h: unknown): string {
  return String(h ?? "").trim().toLowerCase();
}

function findColumn(headerRow: unknown[], candidates: string[]): number {
  return headerRow.findIndex((h) => candidates.includes(normalize(h)));
}

/**
 * Parses a supplier/vendor list from an uploaded Excel file (.xlsx/.xls).
 * Reads the first worksheet, auto-detects the name column from a set of
 * common headers, and skips empty rows, blank name cells, and duplicate
 * names (case-insensitive). Throws a user-facing error message on failure —
 * never attempts XML parsing.
 */
export async function parseSupplierExcel(file: File): Promise<ParsedSupplier[]> {
  const buffer = await file.arrayBuffer();

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "array" });
  } catch {
    throw new Error("Unsupported file format");
  }

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error("No suppliers detected");

  const sheet = workbook.Sheets[firstSheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  if (rows.length === 0) throw new Error("No suppliers detected");

  // Tally exports often prefix the real table with a company-info block
  // (name, address, TRN, statement period, ...), so the header row isn't
  // necessarily row 0 — scan for the first row that has a recognizable
  // name column.
  const HEADER_SCAN_LIMIT = 50;
  let headerRowIndex = -1;
  let nameCol = -1;
  for (let i = 0; i < Math.min(rows.length, HEADER_SCAN_LIMIT); i++) {
    const col = findColumn(rows[i], NAME_HEADERS);
    if (col !== -1) {
      headerRowIndex = i;
      nameCol = col;
      break;
    }
  }
  if (headerRowIndex === -1) throw new Error("No supplier column found");

  const headerRow = rows[headerRowIndex];
  const contactCol = findColumn(headerRow, CONTACT_HEADERS);
  const emailCol   = findColumn(headerRow, EMAIL_HEADERS);
  const phoneCol   = findColumn(headerRow, PHONE_HEADERS);
  const gstCol     = findColumn(headerRow, GST_HEADERS);
  const addressCol = findColumn(headerRow, ADDRESS_HEADERS);

  const cell = (row: unknown[], col: number) => (col >= 0 ? String(row[col] ?? "").trim() : "");

  const seen = new Set<string>();
  const suppliers: ParsedSupplier[] = [];

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c === "" || c == null)) continue; // empty row

    const name = cell(row, nameCol);
    if (!name) continue; // blank name cell

    const key = name.toLowerCase();
    if (seen.has(key)) continue; // duplicate
    seen.add(key);

    suppliers.push({
      name,
      contact: cell(row, contactCol),
      email:   cell(row, emailCol),
      phone:   cell(row, phoneCol),
      gst:     cell(row, gstCol),
      address: cell(row, addressCol),
    });
  }

  if (suppliers.length === 0) throw new Error("No suppliers detected");
  return suppliers;
}
