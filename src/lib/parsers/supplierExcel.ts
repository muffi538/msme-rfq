import * as XLSX from "xlsx";
import { BUILT_IN_CATEGORIES } from "@/lib/categories";

export type ParsedSupplier = {
  name: string;
  company: string;
  contact: string;
  email: string;
  phone: string;
  whatsapp: string;
  whatsappGroupLink: string;
  gst: string;
  address: string;
  city: string;
  state: string;
  country: string;
  categories: string[];
  // Category text from the sheet that didn't match any known category (e.g.
  // "Plumbing Items" vs. the canonical "SANITARY_PLUMBING") — surfaced back
  // to the user rather than silently dropped, since a category that never
  // matches a real value would never route this supplier any items anyway.
  unmatchedCategories: string[];
  brands: string[];
};

const NAME_HEADERS     = ["supplier", "supplier name", "party name", "ledger name", "name", "vendor", "vendor name", "particulars", "party"];
const COMPANY_HEADERS  = ["company", "company name", "organisation", "organization", "firm", "firm name"];
const CONTACT_HEADERS  = ["contact", "contact person", "contact name"];
const EMAIL_HEADERS    = ["email", "email id", "e-mail", "email address"];
// Deliberately excludes "whatsapp"/"whatsapp number" — those get their own
// column below so a sheet with BOTH a phone and a WhatsApp column keeps
// them distinct instead of one silently winning.
const PHONE_HEADERS    = ["phone", "mobile", "mobile number", "contact number", "phone number"];
const WHATSAPP_HEADERS = ["whatsapp", "whatsapp number", "whatsapp no"];
const WHATSAPP_GROUP_HEADERS = ["whatsapp group", "whatsapp group link", "wa group", "wa group link", "group link"];
const GST_HEADERS      = ["gst", "gstin", "gst no", "gst number"];
const ADDRESS_HEADERS  = ["address"];
const CITY_HEADERS     = ["city"];
const STATE_HEADERS    = ["state"];
const COUNTRY_HEADERS  = ["country"];
const CATEGORY_HEADERS = ["category", "categories", "item category", "item categories", "product category", "supplier category"];
const BRAND_HEADERS    = ["brand", "brands", "brand name", "brands supplied"];

function normalize(h: unknown): string {
  return String(h ?? "").trim().toLowerCase();
}

function findColumn(headerRow: unknown[], candidates: string[]): number {
  return headerRow.findIndex((h) => candidates.includes(normalize(h)));
}

// Splits one cell that may hold several values — a category/brand column is
// commonly comma, semicolon, or pipe separated ("Power Tools, Hand Tools").
function splitList(raw: string): string[] {
  return raw.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
}

// Best-effort match against the app's fixed category set — a sheet will
// realistically say "Power Tools" or "Sanitary & Plumbing", not the exact
// enum key. Normalizes punctuation/spacing/case and checks for an exact
// match; anything that doesn't match is reported back rather than stored,
// since a category that can never equal an item's category would never
// actually route this supplier any RFQ items (see split/route.ts's match).
function normalizeCategory(raw: string): string | null {
  const key = raw.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return BUILT_IN_CATEGORIES.includes(key) ? key : null;
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

  const headerRow  = rows[headerRowIndex];
  const companyCol  = findColumn(headerRow, COMPANY_HEADERS);
  const contactCol  = findColumn(headerRow, CONTACT_HEADERS);
  const emailCol    = findColumn(headerRow, EMAIL_HEADERS);
  const phoneCol    = findColumn(headerRow, PHONE_HEADERS);
  const whatsappCol = findColumn(headerRow, WHATSAPP_HEADERS);
  const whatsappGroupCol = findColumn(headerRow, WHATSAPP_GROUP_HEADERS);
  const gstCol      = findColumn(headerRow, GST_HEADERS);
  const addressCol  = findColumn(headerRow, ADDRESS_HEADERS);
  const cityCol     = findColumn(headerRow, CITY_HEADERS);
  const stateCol    = findColumn(headerRow, STATE_HEADERS);
  const countryCol  = findColumn(headerRow, COUNTRY_HEADERS);
  const categoryCol = findColumn(headerRow, CATEGORY_HEADERS);
  const brandCol    = findColumn(headerRow, BRAND_HEADERS);

  const cell = (row: unknown[], col: number) => (col >= 0 ? String(row[col] ?? "").trim() : "");

  const seen = new Set<string>();
  const suppliers: ParsedSupplier[] = [];

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c === "" || c == null)) continue; // empty row

    const name = cell(row, nameCol);
    if (!name) continue; // blank name cell

    const key = name.toLowerCase();
    if (seen.has(key)) continue; // duplicate within this file
    seen.add(key);

    const phone = cell(row, phoneCol);

    const rawCategories = splitList(cell(row, categoryCol));
    const categories: string[] = [];
    const unmatchedCategories: string[] = [];
    for (const raw of rawCategories) {
      const matched = normalizeCategory(raw);
      if (matched) categories.push(matched); else unmatchedCategories.push(raw);
    }

    suppliers.push({
      name,
      company: cell(row, companyCol),
      contact: cell(row, contactCol),
      email:   cell(row, emailCol),
      phone,
      // Falls back to the phone/mobile column when the sheet has no
      // dedicated WhatsApp column — the common case for a plain contact
      // list where one number serves both purposes.
      whatsapp: cell(row, whatsappCol) || phone,
      whatsappGroupLink: cell(row, whatsappGroupCol),
      gst:      cell(row, gstCol),
      city:     cell(row, cityCol),
      state:    cell(row, stateCol),
      country:  cell(row, countryCol),
      address: cell(row, addressCol),
      categories: [...new Set(categories)],
      unmatchedCategories,
      brands: [...new Set(splitList(cell(row, brandCol)))],
    });
  }

  if (suppliers.length === 0) throw new Error("No suppliers detected");
  return suppliers;
}
