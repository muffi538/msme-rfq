"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { Upload, FileText, ImageIcon, Table2, FileType2, Loader2, ClipboardPaste, X, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { pollJob } from "@/lib/pollJob";

const ACCEPTED = ".pdf,.xlsx,.xls,.csv,.docx,.txt,.jpg,.jpeg,.png,.webp";
const MAX_FILES = 10;

type UploadState = "idle" | "uploading" | "error";
type Stage = "uploading" | "ocr" | "parsing" | "matching" | "complete";

const STAGES: { key: Stage; label: string }[] = [
  { key: "uploading", label: "Uploading" },
  { key: "ocr",        label: "OCR" },
  { key: "parsing",    label: "Parsing" },
  { key: "matching",   label: "Matching" },
  { key: "complete",   label: "Complete" },
];

type FileEntry = {
  file: File;
  preview: string | null;
  id: string;
};

type JobResult = {
  rfqId: string;
  rfqCode: string;
  itemCount: number;
  fileCount: number;
  failedFiles: string[];
  warnings: string[];
};

function fileIcon(file: File, size = "w-8 h-8") {
  const name = file.name.toLowerCase();
  if (file.type.includes("pdf"))                        return <FileText  className={`${size} text-red-400`} />;
  if (file.type.includes("image"))                       return <ImageIcon className={`${size} text-blue-400`} />;
  if (name.endsWith(".docx"))                             return <FileType2 className={`${size} text-indigo-400`} />;
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

  // Job progress — one merged RFQ built from every selected file at once.
  const [stage,          setStage]          = useState<Stage | null>(null);
  const [stageProcessed, setStageProcessed] = useState(0);
  const [stageFile,      setStageFile]      = useState<string | null>(null);
  const [jobResult,      setJobResult]      = useState<JobResult | null>(null);

  function makeEntry(f: File): FileEntry {
    const preview = f.type.startsWith("image/") ? URL.createObjectURL(f) : null;
    return { file: f, preview, id: `${f.name}-${Date.now()}-${Math.random()}` };
  }

  function addFiles(incoming: File[]) {
    setError("");
    setState("idle");
    setJobResult(null);
    setEntries((prev) => {
      const existing = new Set(prev.map((e) => e.file.name));
      const fresh = incoming.filter((f) => !existing.has(f.name));
      const combined = [...prev, ...fresh.map(makeEntry)];
      if (combined.length > MAX_FILES) {
        toast.error(`Maximum ${MAX_FILES} files per RFQ — only the first ${MAX_FILES} were kept.`);
        return combined.slice(0, MAX_FILES);
      }
      return combined;
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
    setStage(null);
    setJobResult(null);
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
    if (buyerEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail.trim())) { setError("Enter a valid email address."); return; }

    setState("uploading");
    setError("");
    setStage(null);
    setStageProcessed(0);
    setStageFile(null);
    setJobResult(null);

    const form = new FormData();
    for (const entry of entries) form.append("file", entry.file);
    form.append("buyerName",  buyerName);
    form.append("buyerEmail", buyerEmail.trim());
    form.append("priority",   priority);

    try {
      const res  = await fetch("/api/rfqs/upload", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");

      const result = await pollJob<
        { stage: Stage; processed: number; total: number; currentFile?: string },
        JobResult
      >(json.jobId, (p) => {
        if (!p) return;
        setStage(p.stage);
        setStageProcessed(p.processed);
        setStageFile(p.currentFile ?? null);
      });

      setJobResult(result);
      setState("idle");

      if (result.failedFiles.length > 0) {
        toast.warning(`${result.failedFiles.length} file(s) couldn't be read and were skipped: ${result.failedFiles.join(", ")}`, { duration: 10000 });
      }
      toast.success(`RFQ ${result.rfqCode} processed — ${result.itemCount} item${result.itemCount === 1 ? "" : "s"} from ${result.fileCount} file${result.fileCount === 1 ? "" : "s"}!`);
      setTimeout(() => router.push(`/rfqs/${result.rfqId}`), 800);
    } catch (err: unknown) {
      setState("error");
      const msg = err instanceof Error ? err.message : "Upload failed";
      setError(msg);
      toast.error(msg);
    }
  }

  const busy      = state === "uploading";
  const hasFiles  = entries.length > 0;
  const stageIdx  = stage ? STAGES.findIndex((s) => s.key === stage) : -1;

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
                    <span className="text-sm font-medium text-gray-700">
                      {entries.length} file{entries.length > 1 ? "s" : ""} selected — will be merged into one RFQ
                    </span>
                    {!busy && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); clearAll(); }}
                        className="text-xs text-gray-400 hover:text-red-500 transition-colors">
                        Clear all
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-2">
                    {entries.map((entry, i) => {
                      const failed = jobResult?.failedFiles.includes(entry.file.name);
                      const doneUploading = busy && stageIdx >= 0 && (stage !== "uploading" && stage !== "ocr" ? true : i < stageProcessed);
                      const isCurrent = busy && (stage === "uploading" || stage === "ocr") && entry.file.name === stageFile;
                      return (
                        <div
                          key={entry.id}
                          onClick={(e) => e.stopPropagation()}
                          className={cn(
                            "flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                            jobResult && !failed  && "bg-green-50 border-green-200",
                            failed                && "bg-red-50 border-red-200",
                            !jobResult && isCurrent && "bg-blue-50 border-blue-200",
                            !jobResult && !isCurrent && "bg-gray-50 border-gray-100"
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
                            {failed && <p className="text-xs text-red-500 mt-0.5">Couldn&apos;t be read — skipped</p>}
                          </div>

                          {isCurrent && <Loader2 className="w-4 h-4 animate-spin text-blue-500 flex-shrink-0" />}
                          {jobResult && !failed && <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />}
                          {jobResult && failed && <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />}
                          {!doneUploading && !isCurrent && busy && (
                            <span className="text-[10px] text-gray-400 flex-shrink-0">queued</span>
                          )}
                          {!busy && !jobResult && (
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

                  {!busy && !jobResult && entries.length < MAX_FILES && (
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
                  <p className="text-sm text-gray-400 mt-1">PDF, Excel, CSV, Word (.docx), Image (JPG/PNG/WEBP), or Text</p>
                  <p className="text-xs text-gray-400 mt-1">Select multiple, mixed-format files — they&apos;ll merge into one RFQ</p>
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

            {/* Processing stage tracker */}
            {(busy || jobResult) && (
              <div className="bg-white rounded-2xl border border-gray-100 p-5">
                <div className="flex items-center justify-between">
                  {STAGES.map((s, i) => {
                    const active = jobResult ? true : i <= stageIdx;
                    const current = !jobResult && i === stageIdx;
                    return (
                      <div key={s.key} className="flex items-center flex-1 last:flex-none">
                        <div className="flex flex-col items-center gap-1.5">
                          <div className={cn(
                            "w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors",
                            active ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-400",
                            current && "animate-pulse"
                          )}>
                            {active && !current ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
                          </div>
                          <span className={cn("text-[11px] font-medium", active ? "text-gray-700" : "text-gray-400")}>{s.label}</span>
                        </div>
                        {i < STAGES.length - 1 && (
                          <div className={cn("h-0.5 flex-1 mx-1.5 rounded transition-colors", i < stageIdx || jobResult ? "bg-blue-600" : "bg-gray-100")} />
                        )}
                      </div>
                    );
                  })}
                </div>
                {busy && stageFile && (
                  <p className="text-xs text-gray-400 mt-3 text-center">Processing &ldquo;{stageFile}&rdquo;…</p>
                )}
              </div>
            )}

            {/* Paste from clipboard button */}
            {!busy && !jobResult && (
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
                  <Label>Buyer email</Label>
                  <Input
                    placeholder="buyer@example.com"
                    type="email"
                    value={buyerEmail}
                    onChange={(e) => setBuyerEmail(e.target.value)}
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

            {jobResult && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 bg-green-50 text-green-700 text-sm px-4 py-3 rounded-lg font-medium">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  RFQ {jobResult.rfqCode} processed — {jobResult.itemCount} item{jobResult.itemCount === 1 ? "" : "s"} from {jobResult.fileCount} file{jobResult.fileCount === 1 ? "" : "s"}. Redirecting…
                </div>
                {jobResult.warnings.length > 0 && (
                  <div className="bg-yellow-50 text-yellow-800 text-xs px-4 py-3 rounded-lg space-y-1">
                    {jobResult.warnings.map((w, i) => (
                      <div key={i} className="flex gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {w}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <Button
              type="submit"
              disabled={!hasFiles || !buyerName.trim() || busy || !!jobResult}
              className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-base"
            >
              {busy ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-2" />
                  {STAGES[stageIdx]?.label ?? "Processing"}…</>
              ) : entries.length > 1
                ? `Upload & Merge ${entries.length} Files into One RFQ`
                : "Upload & Process RFQ"}
            </Button>

          </form>
        </div>
      </main>
    </>
  );
}
