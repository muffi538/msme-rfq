import { NextRequest, NextResponse } from "next/server";
import { logError } from "@/lib/logError";
import { createClient } from "@/lib/supabase/server";
import { XMLParser } from "fast-xml-parser";

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
// upsert against. Every field except name is optional/best-effort.
type ImportedSupplier = {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  contact?: string;
  gst?: string;
};

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

      suppliers.push({ name, phone, email, address: addr });
    }
  }

  return suppliers;
}

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

  // Upsert into suppliers table
  let imported = 0;
  let skipped  = 0;

  for (const s of suppliers) {
    const notes = [
      s.address ? `Address: ${s.address}` : null,
      s.gst ? `GST: ${s.gst}` : null,
    ].filter(Boolean).join(" | ") || null;

    const { error } = await supabase
      .from("suppliers")
      .upsert(
        {
          user_id:          user.id,
          name:             s.name,
          contact_person:   s.contact || null,
          whatsapp_number:  s.phone || null,
          email:            s.email || null,
          categories:       [],      // user assigns categories after import
          brands:           [],      // user assigns brands after import, same as categories
          active:           true,
          notes,
        },
        { onConflict: "name" }
      );
    if (error) {
      logError("[tally-sync] supplier upsert failed", { name: s.name, error });
      skipped++;
    } else imported++;
  }

  return NextResponse.json({ imported, skipped, total: suppliers.length });
}
