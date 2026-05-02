"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { Upload, FileText, ImageIcon, Table2, Loader2, ClipboardPaste, X, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const ACCEPTED = ".pdf,.xlsx,.xls,.csv,.txt,.jpg,.jpeg,.png,.webp";

type UploadState = "idle" | "uploading" | "error";

type FileEntry = {
  file: File;
  preview: string | null;
  id: string;
};

type FileResult = {
  id: string;
  rfqId: string;
  itemCount: number;
  fileName: string;
  status: "pending" | "processing" | "done" | "error";
  error?: string;
};

function fileIcon(file: File, size = "w-8 h-8") {
  if (file.type.includes("pdf"))   return <FileText className={`${size} text-red-400`} />;
  if (file.type.includes("image")) return <ImageIcon className={`${size} text-blue-400`} />;
  return <Table2 className={`${size} text-green-400`} />;
}

export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [entries,     setEntries]     = useState<FileEntry[]>([]);
  const [dragging,    setDragging]    = useState(false);
  const [buyerName,   setBuyerName]   = useState("");
  const [buyerEmail,  setBuyerEmail]  = useState("");
  const [priority,    setPriority]    = useState<"normal" | "urgent">("normal");
  const [state,       setState]       = useState<UploadState>("idle");
  const [error,       setError]       = useState("");
  const [results,     setResults]     = useState<FileResult[]>([]);

  function makeEntry(f: File): FileEntry {
    const preview = f.type.startsWith("image/") ? URL.createObjectURL(f) : null;
    return { file: f, preview, id: `${f.name}-${Date.now()}-${Math.random()}` };
  }

  function addFiles(incoming: File[]) {
    setError("");
    setState("idle");
    setEntries((prev) => {
      const existing = new Set(prev.map((e) => e.file.name));
      const fresh = incoming.filter((f) => !existing.has(f.name));
      return [...prev, ...fresh.map(makeEntry)];
    });
  }

  function removeEntry(id: string) {
    setEntries((prev) => {
      const e = prev.find((x) => x.id === id);
      if (e?.preview) URL.revokeObjectURL(e.preview);
      return prev.filter((x) => x.id !== id);
    });
  }

  function clearAll() {
    entries.forEach((e) => { if (e.preview) URL.revokeObjectURL(e.preview); });
    setEntries([]);
    setState("idle");
    setError("");
    setResults([]);
    if (inputRef.current) inputRef.current.value = "";
  }

  // Ctrl+V paste
  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const images: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        const blob = item.getAsFile();
        if (blob) images.push(new File([blob], `paste-${Date.now()}.png`, { type: blob.type }));
      }
    }
    if (images.length) {
      addFiles(images);
      toast.success(`${images.length} screenshot${images.length > 1 ? "s" : ""} pasted!`);
    }
  }, [entries]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleClipboardButton() {
    try {
      const items = await navigator.clipboard.read();
      const images: File[] = [];
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          images.push(new File([blob], `paste-${Date.now()}.png`, { type: imageType }));
        }
      }
      if (images.length) {
        addFiles(images);
        toast.success("Screenshot pasted from clipboard!");
      } else {
        toast.error("No image found in clipboard. Copy a screenshot first.");
      }
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
    addFiles(Array.from(e.dataTransfer.files));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!entries.length) { setError("Please select at least one file."); return; }
    if (!buyerName.trim()) { setError("Buyer name is required."); return; }
    if (!/^[a-zA-Z\s.&'-]+$/.test(buyerName.trim())) { setError("Buyer name must contain letters only, no numbers."); return; }
    if (!buyerEmail.trim()) { setError("Buyer email is required."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail.trim())) { setError("Enter a valid email address."); return; }

    setState("uploading");
    setError("");

    const initial: FileResult[] = entries.map((e) => ({
      id: e.id,
      rfqId: "",
      itemCount: 0,
      fileName: e.file.name,
      status: "pending",
    }));
    setResults(initial);

    let lastRfqId = "";
    let anyError = false;

    for (const entry of entries) {
      setResults((prev) => prev.map((r) => r.id === entry.id ? { ...r, status: "processing" } : r));

      const form = new FormData();
      form.append("file", entry.file);
      form.append("buyerName",  buyerName);
      form.append("buyerEmail", buyerEmail);
      form.append("priority",   priority);

      try {
        const res  = await fetch("/api/rfqs/upload", { method: "POST", body: form });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Upload failed");

        lastRfqId = json.rfqId;
        setResults((prev) => prev.map((r) =>
          r.id === entry.id ? { ...r, status: "done", rfqId: json.rfqId, itemCount: json.itemCount } : r
        ));
      } catch (err: unknown) {
        anyError = true;
        const msg = err instanceof Error ? err.message : "Upload failed";
        setResults((prev) => prev.map((r) =>
          r.id === entry.id ? { ...r, status: "error", error: msg } : r
        ));
      }
    }

    if (!anyError && lastRfqId) {
      const count = entries.length;
      toast.success(count === 1 ? "RFQ processed! Opening…" : `${count} RFQs processed!`);
      if (count === 1) {
        setTimeout(() => router.push(`/rfqs/${lastRfqId}`), 600);
      } else {
        setTimeout(() => router.push("/rfqs"), 1000);
      }
    } else if (anyError) {
      setState("error");
      toast.error("Some files failed to upload.");
    }
  }

  const busy      = state === "uploading";
  const hasFiles  = entries.length > 0;
  const allDone   = results.length > 0 && results.every((r) => r.status === "done");

  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    if (!lightbox) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setLightbox(null); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lightbox]);

  return (
    <>
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt="Preview"
            className="max-w-full max-h-full rounded-2xl shadow-2xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 w-9 h-9 bg-white/20 hover:bg-white/40 rounded-full flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>
      )}
      <DashboardHeader title="Upload RFQ" />
      <main className="flex-1 p-8">
        <div className="max-w-2xl mx-auto">
          <form onSubmit={handleSubmit} className="space-y-6">

            {/* Drop zone */}
            <div
              onClick={() => !busy && inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                "bg-white border-2 border-dashed rounded-2xl transition-colors",
                !busy && "cursor-pointer hover:border-blue-300 hover:bg-blue-50/40",
                dragging ? "border-blue-400 bg-blue-50" : "border-gray-200",
                !hasFiles ? "p-10 flex flex-col items-center justify-center" : "p-4"
              )}
            >
              {hasFiles ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-700">{entries.length} file{entries.length > 1 ? "s" : ""} selected</span>
                    {!busy && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); clearAll(); }}
                        className="text-xs text-gray-400 hover:text-red-500 transition-colors">
                        Clear all
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-2">
                    {entries.map((entry) => {
                      const result = results.find((r) => r.id === entry.id);
                      return (
                        <div
                          key={entry.id}
                          onClick={(e) => e.stopPropagation()}
                          className={cn(
                            "flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                            result?.status === "done"       && "bg-green-50 border-green-200",
                            result?.status === "processing" && "bg-blue-50 border-blue-200",
                            result?.status === "error"      && "bg-red-50 border-red-200",
                            !result                         && "bg-gray-50 border-gray-100"
                          )}
                        >
                          {entry.preview ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={entry.preview}
                              alt=""
                              onClick={(e) => { e.stopPropagation(); setLightbox(entry.preview); }}
                              className="w-10 h-10 object-cover rounded-lg flex-shrink-0 cursor-zoom-in hover:opacity-80 transition-opacity"
                            />
                          ) : (
                            <div className="flex-shrink-0">{fileIcon(entry.file, "w-7 h-7")}</div>
                          )}

                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">{entry.file.name}</p>
                            <p className="text-xs text-gray-400">{(entry.file.size / 1024).toFixed(0)} KB</p>
                            {result?.status === "done" && (
                              <p className="text-xs text-green-600 font-medium mt-0.5">{result.itemCount} items extracted ✓</p>
                            )}
                            {result?.status === "error" && (
                              <p className="text-xs text-red-500 mt-0.5">{result.error}</p>
                            )}
                          </div>

                          {result?.status === "processing" && (
                            <Loader2 className="w-4 h-4 animate-spin text-blue-500 flex-shrink-0" />
                          )}
                          {result?.status === "done" && (
                            <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                          )}
                          {!result && !busy && (
                            <button
                              type="button"
                              onClick={() => removeEntry(entry.id)}
                              className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {!busy && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
                      className="w-full mt-2 text-xs text-blue-600 hover:text-blue-700 font-medium py-1.5 border border-dashed border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
                    >
                      + Add more files
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <Upload className="w-10 h-10 text-gray-300" />
                  <p className="mt-3 font-semibold text-gray-700">Drop your RFQ files here</p>
                  <p className="text-sm text-gray-400 mt-1">PDF, Excel (.xlsx/.xls/.csv), Image (JPG/PNG), or Text (.txt)</p>
                  <p className="text-xs text-gray-400 mt-1">You can select multiple files at once</p>
                  <p className="mt-3 text-xs text-blue-600 font-medium">click to browse</p>
                </>
              )}

              <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED}
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) {
                    addFiles(Array.from(e.target.files));
                    e.target.value = "";
                  }
                }}
              />
            </div>

            {/* Paste from clipboard button */}
            {!busy && (
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

            {allDone && entries.length > 1 && (
              <div className="flex items-center gap-2 bg-green-50 text-green-700 text-sm px-4 py-3 rounded-lg font-medium">
                <CheckCircle2 className="w-4 h-4" />
                All {entries.length} RFQs processed! Redirecting to your RFQ list…
              </div>
            )}

            <Button
              type="submit"
              disabled={!hasFiles || !buyerName.trim() || !buyerEmail.trim() || busy}
              className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-base"
            >
              {busy ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Processing {results.filter((r) => r.status === "done").length} / {entries.length}…</>
              ) : entries.length > 1
                ? `Upload & Process ${entries.length} RFQs`
                : "Upload & Process RFQ"}
            </Button>

          </form>
        </div>
      </main>
    </>
  );
}
