"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Database, Upload, CheckCircle, ArrowRight, Wifi } from "lucide-react";

type Mode = "connect" | "paste";

export default function TallyImportPage() {
  const router  = useRouter();
  const [mode, setMode]       = useState<Mode>("connect");
  const [host, setHost]       = useState("");
  const [port, setPort]       = useState("9000");
  const [xmlData, setXmlData] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<{ imported: number; skipped: number; total: number } | null>(null);
  const [error, setError]     = useState("");

  async function handleImport() {
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const body = mode === "connect"
        ? { host, port: Number(port) }
        : { xmlData };

      const res  = await fetch("/api/suppliers/tally-sync", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Import failed");
      setResult(json);
      toast.success(`${json.imported} suppliers imported from Tally!`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Import failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setXmlData(ev.target?.result as string ?? "");
    reader.readAsText(file);
    setMode("paste");
  }

  return (
    <>
      <DashboardHeader title="Import from Tally" />
      <main className="flex-1 p-8 max-w-2xl mx-auto w-full space-y-6">

        {/* Header info */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center flex-shrink-0">
              <Database className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900 text-lg">Tally Supplier Sync</h2>
              <p className="text-gray-500 text-sm mt-1">
                Import all suppliers from the <strong>Sundry Creditors</strong> group in Tally ERP.
                Imports name, phone, and email automatically.
              </p>
            </div>
          </div>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-2 bg-gray-100 rounded-xl p-1">
          <button
            onClick={() => setMode("connect")}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${mode === "connect" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
          >
            <Wifi className="w-4 h-4" /> Direct Connection
          </button>
          <button
            onClick={() => setMode("paste")}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${mode === "paste" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
          >
            <Upload className="w-4 h-4" /> Upload / Paste XML
          </button>
        </div>

        {/* Direct connection */}
        {mode === "connect" && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">Connect to Tally Server</h3>
              <p className="text-sm text-gray-500">
                Tally must be open on the target machine with the XML gateway enabled (usually port 9000).
              </p>
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Tally Server IP / Hostname</Label>
                <Input
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="e.g. 192.168.1.100 or tally.company.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Port</Label>
                <Input
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="9000"
                  className="w-32"
                />
              </div>
            </div>
            <div className="bg-blue-50 rounded-xl p-4 text-sm text-blue-700 space-y-1">
              <p className="font-medium">How to enable Tally XML Gateway:</p>
              <ol className="list-decimal list-inside space-y-1 text-blue-600">
                <li>Open Tally ERP → Gateway of Tally</li>
                <li>Press F12 → Configure → Enable ODBC Server</li>
                <li>Set port to 9000 and allow external access</li>
                <li>Make sure Windows Firewall allows port 9000</li>
              </ol>
            </div>
          </div>
        )}

        {/* Paste / Upload XML */}
        {mode === "paste" && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">Upload Tally XML Export</h3>
              <p className="text-sm text-gray-500">
                Export ledgers from Tally as XML and upload the file here.
              </p>
            </div>
            <div className="bg-amber-50 rounded-xl p-4 text-sm text-amber-700 space-y-1">
              <p className="font-medium">How to export from Tally:</p>
              <ol className="list-decimal list-inside space-y-1 text-amber-600">
                <li>Open Tally → Gateway of Tally → Display</li>
                <li>Account Books → Ledger → Select group: <strong>Sundry Creditors</strong></li>
                <li>Press Alt+E (Export) → Select format: XML</li>
                <li>Save the file and upload below</li>
              </ol>
            </div>
            <div className="space-y-3">
              <div>
                <Label>Upload XML file</Label>
                <input
                  type="file"
                  accept=".xml,.txt"
                  onChange={handleFileUpload}
                  className="mt-1.5 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
              </div>
              <div className="text-center text-gray-400 text-xs">— or paste XML directly —</div>
              <textarea
                value={xmlData}
                onChange={(e) => setXmlData(e.target.value)}
                rows={8}
                placeholder="Paste Tally XML export here..."
                className="w-full text-xs font-mono border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none text-gray-700"
              />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 text-red-700 rounded-xl px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {/* Success */}
        {result && (
          <div className="bg-green-50 rounded-xl p-4 flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-green-800">Import complete!</p>
              <p className="text-sm text-green-700 mt-0.5">
                {result.imported} suppliers imported · {result.skipped} skipped (duplicates)
              </p>
              <p className="text-xs text-green-600 mt-1">
                Now go to <strong>Suppliers</strong> to assign categories to each supplier.
              </p>
            </div>
          </div>
        )}

        {/* Import button */}
        <Button
          onClick={handleImport}
          disabled={loading || (mode === "connect" ? !host : !xmlData)}
          className="w-full h-12 bg-green-600 hover:bg-green-700 text-white font-semibold text-base gap-2"
        >
          {loading
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Importing from Tally...</>
            : <><Database className="w-4 h-4" /> Import Suppliers from Tally</>}
        </Button>

        {result && (
          <Button
            variant="outline"
            onClick={() => router.push("/suppliers")}
            className="w-full h-11 gap-2"
          >
            View Imported Suppliers <ArrowRight className="w-4 h-4" />
          </Button>
        )}

      </main>
    </>
  );
}
