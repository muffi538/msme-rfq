import { NextRequest, NextResponse } from "next/server";
import { logError } from "@/lib/logError";
import { createClient } from "@/lib/supabase/server";
import { XMLParser } from "fast-xml-parser";
import { mapWithConcurrency } from "@/lib/concurrency";
import { normalizePhone, buildWaLink } from "@/lib/whatsapp";
import { validateSupplier, normalizeForMatch } from "@/lib/suppliers";

// Tally XML request — fetches all ledgers under "Sundry Creditors" (suppliers)
const TALLY_XML = `<ENVELOPE>
 <HEADER>
  <TALLYREQUEST>Export Data</TALLYREQUEST>
 </HEADER>
 <BODY>
  <EXPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>List of Ledgers</REPORTNAME>
    <STATICVARIABLES>
     <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    </STATICVARIABLES>
   </REQUESTDESC>
  </EXPORTDATA>
 </BODY>
</ENVELOPE>`;

type TallyLedger = {
  NAME?: string;
  PARENT?: string;
  LEDGERMOBILE?: string;
  MOBILENUMBER?: string;
  EMAIL?: string;
  EMAILID?: string;
  ADDRESS?: string | string[];
  WEBSITE?: string;
};

// Common shape both the Tally XML parser and the client-parsed Excel path
// (see lib/parsers/supplierExcel.ts) upsert against. Every field except
// name is optional/best-effort.
type ImportedSupplier = {
  name: string;
  company?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  contact?: string;
  gst?: string;
};

const IMPORT_CONCURRENCY = 5;

function str(v: unknown): string {
  if (!v) return "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v).trim();
}

function extractSuppliers(xmlText: string): ImportedSupplier[] {
  const parser = new XMLParser({ ignoreAttributes: false, parseAttributeValue: true });
  const data   = parser.parse(xmlText) as Record<string, unknown>;

  // Navigate Tally envelope structure
  const envelope  = (data.ENVELOPE ?? data.envelope ?? {}) as Record<string, unknown>;
  const body      = (envelope.BODY ?? envelope.body ?? {}) as Record<string, unknown>;
  const data2     = (body.DATA ?? body.data ?? {}) as Record<string, unknown>;
  const tallymsg  = data2.TALLYMESSAGE ?? data2.tallymessage ?? [];

  const messages  = Array.isArray(tallymsg) ? tallymsg : [tallymsg];

  const suppliers: ImportedSupplier[] = [];

  for (const msg of messages) {
    const ledgerRaw = (msg as Record<string, unknown>).LEDGER;
    if (!ledgerRaw) continue;

    const ledgers: TallyLedger[] = Array.isArray(ledgerRaw) ? ledgerRaw : [ledgerRaw];

    for (const l of ledgers) {
      const parent = str(l.PARENT).toLowerCase();
      // Only import suppliers (Sundry Creditors group)
      if (!parent.includes("sundry creditor") && !parent.includes("supplier")) continue;

      const name  = str(l.NAME);
      if (!name) continue;

      const phone = str(l.LEDGERMOBILE || l.MOBILENUMBER);
      const email = str(l.EMAIL || l.EMAILID);
      const addr  = str(l.ADDRESS);

      // Tally doesn't expose a separate WhatsApp field — the ledger's
      // mobile number doubles as WhatsApp, same fallback the Excel parser
      // uses when a sheet has no dedicated WhatsApp column.
      suppliers.push({ name, phone, whatsapp: phone, email, address: addr });
    }
  }

  return suppliers;
}

type ExistingSupplierRow = { id: string; name: string; whatsapp_number: string | null; email: string | null };

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const body = await request.json() as {
    host?: string;
    port?: number;
    xmlData?: string;
    suppliers?: ImportedSupplier[]; // pre-parsed client-side from an Excel upload — never touches the XML parser
  };

  let suppliers: ImportedSupplier[];

  if (body.suppliers) {
    // Mode 0: Excel upload, already parsed in the browser with SheetJS.
    if (!Array.isArray(body.suppliers) || body.suppliers.length === 0 || body.suppliers.some((s) => !s?.name)) {
      return NextResponse.json({ error: "No suppliers detected" }, { status: 422 });
    }
    suppliers = body.suppliers;
  } else {
    let xmlText = "";

    if (body.xmlData) {
      // Mode 1: User pasted / uploaded Tally XML directly
      xmlText = body.xmlData;
    } else if (body.host) {
      // Mode 2: Direct connection to Tally server
      const host = body.host.replace(/^https?:\/\//, "").replace(/\/$/, "");
      const port = body.port ?? 9000;
      const url  = `http://${host}:${port}`;

      try {
        const res = await fetch(url, {
          method:  "POST",
          headers: { "Content-Type": "text/xml" },
          body:    TALLY_XML,
          signal:  AbortSignal.timeout(10000),
        });
        if (!res.ok) throw new Error(`Tally returned HTTP ${res.status}`);
        xmlText = await res.text();
      } catch (err: unknown) {
        return NextResponse.json(
          { error: `Cannot connect to Tally at ${url}. Make sure Tally is open and the IP/port is correct. Error: ${err instanceof Error ? err.message : String(err)}` },
          { status: 502 }
        );
      }
    } else {
      return NextResponse.json({ error: "Provide either host, xmlData, or suppliers" }, { status: 400 });
    }

    try {
      suppliers = extractSuppliers(xmlText);
    } catch (err) {
      return NextResponse.json({ error: `Failed to parse Tally XML: ${err}` }, { status: 422 });
    }

    if (suppliers.length === 0) {
      return NextResponse.json({ error: "No suppliers found in Tally data. Make sure ledgers are under 'Sundry Creditors' group." }, { status: 404 });
    }
  }

  // Fetch this user's existing suppliers ONCE — duplicate detection then
  // runs entirely in memory instead of one query per imported row, which
  // matters once an account has hundreds of suppliers and imports another
  // few hundred at a time.
  const { data: existingRows } = await supabase
    .from("suppliers")
    .select("id, name, whatsapp_number, email")
    .eq("user_id", user.id) as { data: ExistingSupplierRow[] | null };
  const existing = existingRows ?? [];

  const byName     = new Map(existing.map((s) => [normalizeForMatch(s.name), s]));
  const byWhatsapp = new Map(existing.filter((s) => s.whatsapp_number).map((s) => [s.whatsapp_number as string, s]));
  const byEmail    = new Map(existing.filter((s) => s.email).map((s) => [normalizeForMatch(s.email), s]));
  // Names already claimed by a row queued for insert earlier in THIS same
  // batch — the Excel parser already dedupes within one file, but the
  // Tally-XML path doesn't, and without this a same-named row later in the
  // batch would be queued as a second insert and collide with the first on
  // the (user_id, name) constraint instead of being recognized as a
  // duplicate of what this import itself just added.
  const claimedThisBatch = new Set<string>();

  let imported = 0, updated = 0, skipped = 0, failed = 0;
  const errors: string[] = [];

  type Row = Record<string, unknown>;
  const toInsert: Row[] = [];
  const toUpdate: { id: string; patch: Row }[] = [];

  for (const s of suppliers) {
    const name = (s.name ?? "").trim();
    if (!name) { skipped++; continue; } // blank row — already filtered by the Excel parser, but the XML/manual-paste paths aren't guaranteed to be

    const whatsappRaw = s.whatsapp || s.phone || "";
    const validationErrors = validateSupplier({ name, email: s.email, whatsapp_number: whatsappRaw, phone_number: s.phone });
    if (validationErrors.length > 0) {
      failed++;
      errors.push(`"${name}": ${validationErrors.join(" ")}`);
      continue;
    }

    const normalizedWhatsapp = whatsappRaw ? normalizePhone(whatsappRaw) : "";
    const nameKey  = normalizeForMatch(name);
    const emailKey = s.email ? normalizeForMatch(s.email) : "";

    const match = byName.get(nameKey)
      ?? (normalizedWhatsapp ? byWhatsapp.get(normalizedWhatsapp) : undefined)
      ?? (emailKey ? byEmail.get(emailKey) : undefined);

    const notes = [
      s.gst ? `GST: ${s.gst}` : null,
    ].filter(Boolean).join(" | ") || null;

    if (match) {
      // Update — fill in any newly-provided field, never blank out data the
      // existing record already has that this row simply didn't include.
      const patch: Row = {};
      if (s.company) patch.company_name = s.company;
      if (s.contact) patch.contact_person = s.contact;
      if (s.email) patch.email = s.email;
      if (whatsappRaw) { patch.whatsapp_number = normalizedWhatsapp || whatsappRaw; patch.whatsapp_link = buildWaLink(whatsappRaw); }
      if (s.phone) patch.phone_number = s.phone;
      if (s.address) patch.address = s.address;
      if (s.city) patch.city = s.city;
      if (s.state) patch.state = s.state;
      if (s.country) patch.country = s.country;
      if (s.gst) patch.gst_number = s.gst;
      if (notes) patch.notes = notes;
      toUpdate.push({ id: match.id, patch });
    } else if (claimedThisBatch.has(nameKey)) {
      skipped++;
    } else {
      claimedThisBatch.add(nameKey);
      toInsert.push({
        user_id:          user.id,
        name,
        company_name:     s.company || null,
        contact_person:   s.contact || null,
        email:            s.email || null,
        whatsapp_number:  normalizedWhatsapp || whatsappRaw || null,
        whatsapp_link:    whatsappRaw ? buildWaLink(whatsappRaw) : null,
        phone_number:     s.phone || null,
        address:          s.address || null,
        city:             s.city || null,
        state:            s.state || null,
        country:          s.country || null,
        gst_number:       s.gst || null,
        categories:       [], // user assigns categories after import
        brands:           [], // user assigns brands after import, same as categories
        active:           true,
        notes,
      });
    }
  }

  // Inserted one row at a time (bounded concurrency, not one batch insert)
  // so a single bad row — e.g. a race against a manually-added supplier
  // with the same name between the lookup above and now — fails only that
  // row instead of a single Postgres constraint violation aborting the
  // entire batch and silently losing every other valid row in it.
  await mapWithConcurrency(toInsert, IMPORT_CONCURRENCY, async (row) => {
    const { error } = await supabase.from("suppliers").insert(row);
    if (error) {
      failed++;
      errors.push(`"${row.name}": ${error.message}`);
      logError("[tally-sync] supplier insert failed", { name: row.name, error });
    } else {
      imported++;
    }
  });

  await mapWithConcurrency(toUpdate, IMPORT_CONCURRENCY, async ({ id, patch }) => {
    if (Object.keys(patch).length === 0) { skipped++; return; } // matched an existing row but had nothing new to add
    const { error } = await supabase.from("suppliers").update(patch).eq("id", id);
    if (error) {
      failed++;
      errors.push(`Update failed: ${error.message}`);
      logError("[tally-sync] supplier update failed", { id, error });
    } else {
      updated++;
    }
  });

  return NextResponse.json({
    total: suppliers.length,
    imported,
    updated,
    skipped,
    failed,
    errors: errors.slice(0, 20), // cap — a bad file could otherwise return thousands of error lines
  });
}
