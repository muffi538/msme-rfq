import { NextRequest, NextResponse } from "next/server";
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

function str(v: unknown): string {
  if (!v) return "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v).trim();
}

function extractSuppliers(xmlText: string) {
  const parser = new XMLParser({ ignoreAttributes: false, parseAttributeValue: true });
  const data   = parser.parse(xmlText) as Record<string, unknown>;

  // Navigate Tally envelope structure
  const envelope  = (data.ENVELOPE ?? data.envelope ?? {}) as Record<string, unknown>;
  const body      = (envelope.BODY ?? envelope.body ?? {}) as Record<string, unknown>;
  const data2     = (body.DATA ?? body.data ?? {}) as Record<string, unknown>;
  const tallymsg  = data2.TALLYMESSAGE ?? data2.tallymessage ?? [];

  const messages  = Array.isArray(tallymsg) ? tallymsg : [tallymsg];

  const suppliers: { name: string; phone: string; email: string; address: string }[] = [];

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

  const body = await request.json() as { host?: string; port?: number; xmlData?: string };

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
    return NextResponse.json({ error: "Provide either host or xmlData" }, { status: 400 });
  }

  let suppliers;
  try {
    suppliers = extractSuppliers(xmlText);
  } catch (err) {
    return NextResponse.json({ error: `Failed to parse Tally XML: ${err}` }, { status: 422 });
  }

  if (suppliers.length === 0) {
    return NextResponse.json({ error: "No suppliers found in Tally data. Make sure ledgers are under 'Sundry Creditors' group." }, { status: 404 });
  }

  // Upsert into suppliers table
  let imported = 0;
  let skipped  = 0;

  for (const s of suppliers) {
    const { error } = await supabase
      .from("suppliers")
      .upsert(
        {
          user_id:          user.id,
          name:             s.name,
          whatsapp_number:  s.phone || null,
          email:            s.email || null,
          categories:       [],      // user assigns categories after import
          active:           true,
          notes:            s.address ? `Address: ${s.address}` : null,
        },
        { onConflict: "user_id,name" }
      );
    if (error) skipped++;
    else imported++;
  }

  return NextResponse.json({ imported, skipped, total: suppliers.length });
}
