"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { Upload, FileText, ImageIcon, Table2, Loader2, ClipboardPaste, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const ACCEPTED = ".pdf,.xlsx,.xls,.csv,.txt,.jpg,.jpeg,.png,.webp";

type UploadState = "idle" | "uploading" | "processing" | "error";

export default function UploadPage() {
  const router   = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file,        setFile]        = useState<File | null>(null);
  const [preview,     setPreview]     = useState<string | null>(null);
  const [dragging,    setDragging]    = useState(false);
  const [buyerName,   setBuyerName]   = useState("");
  const [buyerEmail,  setBuyerEmail]  = useState("");
  const [priority,    setPriority]    = useState<"normal" | "urgent">("normal");
  const [state,       setState]       = useState<UploadState>("idle");
  const [error,       setError]       = useState("");

  function pickFile(f: File) {
    setFile(f);
    setError("");
    setState("idle");
    // Generate preview for images
    if (f.type.startsWith("image/")) {
      const url = URL.createObjectURL(f);
      setPreview(url);
    } else {
      setPreview(null);
    }
  }

  function clearFile() {
    setFile(null);
    setPreview(null);
    setState("idle");
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  }

  // Ctrl+V paste from clipboard
  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        const blob = item.getAsFile();
        if (blob) {
          const named = new File([blob], `paste-${Date.now()}.png`, { type: blob.type });
          pickFile(named);
          toast.success("Screenshot pasted! Ready to upload.");
          return;
        }
      }
    }
  }, []);

  // Button click — reads image from clipboard via Clipboard API
  async function handleClipboardButton() {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          const named = new File([blob], `paste-${Date.now()}.png`, { type: imageType });
          pickFile(named);
          toast.success("Screenshot pasted from clipboard!");
          return;
        }
      }
      toast.error("No image found in clipboard. Copy a screenshot first.");
    } catch {
      toast.error("Could not read clipboard. Try pressing Ctrl+V instead.");
    }
  }

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

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
    if (!buyerName.trim()) { setError("Buyer name is required."); return; }
    if (!/^[a-zA-Z\s.&'-]+$/.test(buyerName.trim())) { setError("Buyer name must contain letters only, no numbers."); return; }
    if (!buyerEmail.trim()) { setError("Buyer email is required."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail.trim())) { setError("Enter a valid email address."); return; }

    setState("uploading");
    setError("");

    const form = new FormData();
    form.append("file", file);
    form.append("buyerName",  buyerName);
    form.append("buyerEmail", buyerEmail);
    form.append("priority",   priority);

    try {
      setState("processing");
      const res  = await fetch("/api/rfqs/upload", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");

      toast.success(`${json.itemCount} items extracted and categorised!`);
      // Go straight to the RFQ detail page
      router.push(`/rfqs/${json.rfqId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
      setState("error");
      toast.error(msg);
    }
  }

  const busy = state === "uploading" || state === "processing";

  return (
    <>
      <DashboardHeader title="Upload RFQ" />
      <main className="flex-1 p-8">
        <div className="max-w-2xl mx-auto">
          <form onSubmit={handleSubmit} className="space-y-6">

            {/* Drop / paste zone */}
            <div
              onClick={() => !file && inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                "bg-white border-2 border-dashed rounded-2xl transition-colors relative overflow-hidden",
                !file && "cursor-pointer hover:border-blue-300 hover:bg-blue-50/40",
                dragging ? "border-blue-400 bg-blue-50" : "border-gray-200",
                file ? "p-0" : "p-10 flex flex-col items-center justify-center"
              )}
            >
              {/* Image preview */}
              {preview && file ? (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={preview} alt="Preview" className="w-full max-h-72 object-contain rounded-2xl" />
                  <div className="absolute inset-0 bg-black/0 hover:bg-black/10 rounded-2xl transition-colors" />
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); clearFile(); }}
                    className="absolute top-3 right-3 w-7 h-7 bg-white rounded-full shadow flex items-center justify-center hover:bg-red-50 hover:text-red-500 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/40 to-transparent rounded-b-2xl px-4 py-3">
                    <p className="text-white text-sm font-medium truncate">{file.name}</p>
                    <p className="text-white/70 text-xs">{(file.size / 1024).toFixed(0)} KB</p>
                  </div>
                </div>
              ) : file ? (
                /* Non-image file */
                <div className="p-6 flex items-center gap-4">
                  {fileIcon()}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-800 truncate">{file.name}</p>
                    <p className="text-sm text-gray-400">{(file.size / 1024).toFixed(0)} KB</p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); clearFile(); }}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                /* Empty state */
                <>
                  {fileIcon()}
                  <p className="mt-3 font-semibold text-gray-700">Drop your RFQ file here</p>
                  <p className="text-sm text-gray-400 mt-1">PDF, Excel (.xlsx/.xls/.csv), Image (JPG/PNG), or Text (.txt)</p>

                  <p className="mt-3 text-xs text-blue-600 font-medium">click to browse</p>
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

            {/* Paste from clipboard button */}
            {!file && (
              <button
                type="button"
                onClick={handleClipboardButton}
                className="w-full flex items-center justify-center gap-2.5 bg-purple-50 hover:bg-purple-100 border border-purple-200 hover:border-purple-300 text-purple-700 font-medium text-sm rounded-2xl py-4 transition-colors"
              >
                <ClipboardPaste className="w-5 h-5" />
                Paste screenshot from clipboard
                <span className="text-purple-400 text-xs font-normal ml-1">(or press Ctrl + V)</span>
              </button>
            )}

            {/* Buyer details */}
            <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
              <h3 className="font-semibold text-gray-900">Buyer details <span className="text-red-500">*</span></h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Buyer name <span className="text-red-500">*</span></Label>
                  <Input
                    placeholder="Sharma Traders"
                    value={buyerName}
                    onChange={(e) => {
                      // letters, spaces, dots, &, hyphens only — no digits
                      const val = e.target.value.replace(/[^a-zA-Z\s.&'-]/g, "");
                      setBuyerName(val);
                    }}
                    className={!buyerName.trim() && error ? "border-red-400" : ""}
                  />
                  <p className="text-xs text-gray-400">Letters only — no numbers</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Buyer email <span className="text-red-500">*</span></Label>
                  <Input
                    placeholder="buyer@example.com"
                    type="email"
                    value={buyerEmail}
                    onChange={(e) => setBuyerEmail(e.target.value)}
                    className={!buyerEmail.trim() && error ? "border-red-400" : ""}
                  />
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
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={!file || !buyerName.trim() || !buyerEmail.trim() || busy}
              className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-base"
            >
              {busy ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-2" />
                  {state === "uploading" ? "Uploading..." : "AI is reading and categorising..."}</>
              ) : "Upload & Process RFQ"}
            </Button>

          </form>
        </div>
      </main>
    </>
  );
}
