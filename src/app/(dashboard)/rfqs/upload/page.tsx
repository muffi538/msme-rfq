"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { Upload, FileText, ImageIcon, Table2, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const ACCEPTED = ".pdf,.xlsx,.xls,.csv,.jpg,.jpeg,.png,.webp";

type UploadState = "idle" | "uploading" | "processing" | "done" | "error";

export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile]           = useState<File | null>(null);
  const [dragging, setDragging]   = useState(false);
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [priority, setPriority]   = useState<"normal" | "urgent">("normal");
  const [state, setState]         = useState<UploadState>("idle");
  const [error, setError]         = useState("");
  const [rfqId, setRfqId]         = useState("");

  function pickFile(f: File) {
    setFile(f);
    setError("");
    setState("idle");
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) pickFile(f);
  }

  function fileIcon() {
    if (!file) return <Upload className="w-10 h-10 text-gray-300" />;
    if (file.type.includes("pdf"))   return <FileText className="w-10 h-10 text-red-400" />;
    if (file.type.includes("image")) return <ImageIcon className="w-10 h-10 text-blue-400" />;
    return <Table2 className="w-10 h-10 text-green-400" />;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { setError("Please select a file."); return; }

    setState("uploading");
    setError("");

    const form = new FormData();
    form.append("file", file);
    form.append("buyerName", buyerName);
    form.append("buyerEmail", buyerEmail);
    form.append("priority", priority);

    try {
      setState("processing");
      const res = await fetch("/api/rfqs/upload", { method: "POST", body: form });
      const json = await res.json();

      if (!res.ok) throw new Error(json.error ?? "Upload failed");

      setRfqId(json.rfqId);
      setState("done");
      toast.success(`${json.itemCount} items extracted and categorised!`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
      setState("error");
      toast.error(msg);
    }
  }

  if (state === "done") {
    return (
      <>
        <DashboardHeader title="Upload RFQ" />
        <main className="flex-1 flex items-center justify-center p-8">
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center max-w-md w-full shadow-sm">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">RFQ processed!</h2>
            <p className="text-gray-500 text-sm mb-6">
              Items have been extracted and categorised. Review them in the RFQ detail view.
            </p>
            <div className="flex gap-3 justify-center">
              <Button onClick={() => router.push("/rfqs")} className="bg-blue-600 hover:bg-blue-700 text-white">
                View all RFQs
              </Button>
              <Button variant="outline" onClick={() => { setFile(null); setState("idle"); }}>
                Upload another
              </Button>
            </div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <DashboardHeader title="Upload RFQ" />
      <main className="flex-1 p-8">
        <div className="max-w-2xl mx-auto">
          <form onSubmit={handleSubmit} className="space-y-6">

            {/* Drop zone */}
            <div
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                "bg-white border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center cursor-pointer transition-colors",
                dragging ? "border-blue-400 bg-blue-50" : "border-gray-200 hover:border-blue-300 hover:bg-blue-50/40"
              )}
            >
              {fileIcon()}
              {file ? (
                <>
                  <p className="mt-3 font-semibold text-gray-800">{file.name}</p>
                  <p className="text-sm text-gray-400">{(file.size / 1024).toFixed(0)} KB · Click to change</p>
                </>
              ) : (
                <>
                  <p className="mt-3 font-semibold text-gray-700">Drop your RFQ file here</p>
                  <p className="text-sm text-gray-400 mt-1">PDF, Excel (.xlsx/.xls/.csv), or Image (JPG/PNG)</p>
                  <p className="mt-3 text-xs text-blue-600 font-medium">or click to browse</p>
                </>
              )}
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED}
                className="hidden"
                onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])}
              />
            </div>

            {/* Buyer details */}
            <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
              <h3 className="font-semibold text-gray-900">Buyer details (optional)</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Buyer name</Label>
                  <Input placeholder="Sharma Traders" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Buyer email</Label>
                  <Input placeholder="buyer@example.com" type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <div className="flex gap-3">
                  {(["normal", "urgent"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPriority(p)}
                      className={cn(
                        "px-4 py-2 rounded-lg text-sm font-medium border transition-colors capitalize",
                        priority === p
                          ? p === "urgent" ? "bg-red-600 text-white border-red-600" : "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={!file || state === "processing" || state === "uploading"}
              className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-base"
            >
              {state === "uploading" || state === "processing" ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-2" />
                  {state === "uploading" ? "Uploading..." : "AI is processing..."}</>
              ) : "Upload & Process RFQ"}
            </Button>
          </form>
        </div>
      </main>
    </>
  );
}
