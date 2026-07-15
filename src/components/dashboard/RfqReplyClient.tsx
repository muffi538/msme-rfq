"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, ClipboardPaste, Upload, FileText, ImageIcon,
  Sparkles, Send, CheckCircle2, X, Pencil, RotateCcw, Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExtractedQuote, QuoteItem } from "@/app/api/rfq-reply/extract/route";
import { RfqWorkflowTracker } from "@/components/dashboard/RfqWorkflowTracker";
import { RfqLifecycleExpand } from "@/components/dashboard/RfqLifecycleExpand";
import { WORKFLOW_STEPS, type WorkflowStepView } from "@/lib/rfq-lifecycle";
import { ChevronDown, ChevronRight } from "lucide-react";

type Step = "input" | "extracting" | "review";

// A quotation can arrive as several WhatsApp screenshots (a long price
// list split across screens) — must match MAX_FILES in
// src/app/api/rfq-reply/extract/route.ts.
const MAX_FILES = 6;

type StagedFile = { file: File; previewUrl: string | null };

export default function RfqReplyClient() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Input state ──
  const [inputMode, setInputMode]     = useState<"paste" | "upload" | "text">("paste");
  const [files, setFiles]             = useState<StagedFile[]>([]);
  const [textInput, setTextInput]     = useState("");

  // ── Flow state ──
  const [step, setStep]               = useState<Step>("input");
  const [quote, setQuote]             = useState<ExtractedQuote | null>(null);
  const [items, setItems]             = useState<QuoteItem[]>([]);

  // ── Email compose state ──
  const [toEmail, setToEmail]         = useState("");
  const [subject, setSubject]         = useState("");
  const [body, setBody]               = useState("");
  const [sending, setSending]         = useState(false);
  const [sent, setSent]               = useState(false);
  const [sentAt, setSentAt]           = useState<string | null>(null);
  const [sentDetailsOpen, setSentDetailsOpen] = useState(false);

// Adds new files to the staged batch, capped at MAX_FILES total (extra
  // files beyond the cap are silently dropped — see the toast in each
  // caller for the user-facing warning).
  function addFiles(newFiles: File[], onLimitHit?: () => void) {
    setFiles((prev) => {
      const room = MAX_FILES - prev.length;
      if (room <= 0) { onLimitHit?.(); return prev; }
      const accepted = newFiles.slice(0, room);
      if (newFiles.length > accepted.length) onLimitHit?.();
      const staged = accepted.map((f) => ({
        file: f,
        previewUrl: f.type.startsWith("image/") ? URL.createObjectURL(f) : null,
      }));
      return [...prev, ...staged];
    });
  }

  function removeFile(index: number) {
    setFiles((prev) => {
      const target = prev[index];
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }

  // ── Clipboard paste (Ctrl+V anywhere) — appends to the batch, so pasting
  // several screenshots in a row (e.g. a long price list split across
  // WhatsApp screens) stages all of them for one combined extraction. ──
  const handlePaste = useCallback((e: ClipboardEvent) => {
    if (step !== "input") return;
    const clipItems = e.clipboardData?.items;
    if (!clipItems) return;
    for (const item of Array.from(clipItems)) {
      if (item.type.startsWith("image/")) {
        const blob = item.getAsFile();
        if (!blob) continue;
        const f = new File([blob], `paste-${Date.now()}.png`, { type: blob.type });
        setInputMode("paste");
        addFiles([f], () => toast.error(`Maximum ${MAX_FILES} screenshots at once.`));
        toast.success("Screenshot added — paste another or hit Extract");
        return;
      }
    }
    // Text paste — only when textarea is NOT focused (handled natively by textarea)
  }, [step]);

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  async function handleClipboardButton() {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          const f = new File([blob], `paste-${Date.now()}.png`, { type: imageType });
          setInputMode("paste");
          addFiles([f], () => toast.error(`Maximum ${MAX_FILES} screenshots at once.`));
          toast.success("Screenshot added!");
          return;
        }
      }
      toast.error("No image in clipboard. Copy a WhatsApp screenshot first.");
    } catch {
      toast.error("Could not read clipboard — try pressing Ctrl+V instead.");
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length === 0) return;
    setInputMode("upload");
    addFiles(picked, () => toast.error(`Maximum ${MAX_FILES} files at once — the rest were skipped.`));
    e.target.value = "";
  }

  function reset() {
    files.forEach((sf) => { if (sf.previewUrl) URL.revokeObjectURL(sf.previewUrl); });
    setFiles([]);
    setTextInput("");
    setInputMode("paste");
    setStep("input");
    setQuote(null);
    setItems([]);
    setToEmail("");
    setSubject("");
    setBody("");
    setSent(false);
    setSentAt(null);
    setSentDetailsOpen(false);
  }

  function replyWorkflowSteps(): WorkflowStepView[] {
    const flags = {
      inquiry: true,
      supplier_sent: true,
      quote_received: step === "review" || sent,
      buyer_notified: sent,
    };
    const order = WORKFLOW_STEPS.map((s) => s.id);
    const allComplete = order.every((id) => flags[id as keyof typeof flags]);
    let currentId = order[order.length - 1];
    for (const id of order) {
      if (!flags[id as keyof typeof flags]) {
        currentId = id;
        break;
      }
    }
    return WORKFLOW_STEPS.map((s) => ({
      ...s,
      state: flags[s.id as keyof typeof flags]
        ? "completed"
        : !allComplete && s.id === currentId
          ? "current"
          : "pending",
    }));
  }

  async function handleExtract() {
    setStep("extracting");

    try {
      let res: Response;

      if (inputMode === "text") {
        res = await fetch("/api/rfq-reply/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: textInput }),
        });
      } else {
        if (files.length === 0) { toast.error("No file to process"); setStep("input"); return; }
        const form = new FormData();
        files.forEach(({ file }) => form.append("files", file));
        res = await fetch("/api/rfq-reply/extract", { method: "POST", body: form });
      }

      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "Extraction failed");
      }

      const data = await res.json() as ExtractedQuote;
      setQuote(data);
      setItems(data.items.map((item, i) => ({ ...item, _id: i })) as QuoteItem[]);
      setSubject(data.email_subject);
      setBody(data.email_body);
      setStep("review");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to process quote");
      setStep("input");
    }
  }

  async function handleSend() {
    if (!toEmail || !subject || !body) {
      toast.error("Recipient email, subject and body are required");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/rfq-reply/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: toEmail,
          subject,
          body,
          supplierName: quote?.supplier_name ?? null,
          quoteSummary: quote
            ? {
                supplier_name: quote.supplier_name,
                items,
                delivery_days: quote.delivery_days,
                payment_terms: quote.payment_terms,
                validity_days: quote.validity_days,
              }
            : null,
        }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "Send failed");
      }
      const json = await res.json() as { sentAt?: string };
      setSent(true);
      setSentAt(json.sentAt ?? new Date().toISOString());
      toast.success("Buyer notified successfully");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to send email");
    } finally {
      setSending(false);
    }
  }

  function updateItem(index: number, field: keyof QuoteItem, value: string | number | null) {
    setItems((prev) => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  }

  // ── Sync item edits back into email body ──
  function rebuildEmailBody() {
    if (!quote) return;
    const itemLines = items
      .map((item, i) => {
        const price = item.unit_price != null ? `₹${item.unit_price}` : "TBD";
        const qty   = item.qty != null ? `${item.qty}${item.unit ? " " + item.unit : ""}` : "TBD";
        return `${i + 1}. ${item.name} — Qty: ${qty} — Rate: ${price}${item.notes ? ` (${item.notes})` : ""}`;
      })
      .join("\n");

    const deliveryLine = quote.delivery_days ? `\nDelivery Time: ${quote.delivery_days} working days` : "";
    const paymentLine  = quote.payment_terms ? `\nPayment Terms: ${quote.payment_terms}` : "";
    const validityLine = quote.validity_days ? `\nQuotation Valid For: ${quote.validity_days} days` : "";

    const newBody = body.replace(
      /\n?1\. [\s\S]*?(?=\n(?:Delivery|Payment|Quotation|Warm|Regards|Thanks|Thank)|$)/,
      `\n${itemLines}`
    );
    // Only replace if the pattern matched something meaningful; otherwise append
    if (newBody !== body) {
      setBody(newBody);
    } else {
      setBody(`${body}\n\nUpdated Items:\n${itemLines}${deliveryLine}${paymentLine}${validityLine}`);
    }
  }

  const canExtract =
    (inputMode === "text" && textInput.trim().length > 10) ||
    ((inputMode === "paste" || inputMode === "upload") && files.length > 0);

  return (
    <div className="max-w-3xl mx-auto space-y-6">

      {/* ── Lifecycle tracker ── */}
      <div className="bg-card border border-border rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <RfqWorkflowTracker steps={replyWorkflowSteps()} showLabels />
        {step === "extracting" && (
          <div className="flex items-center gap-2 text-blue-600 text-sm font-medium">
            <Loader2 className="w-4 h-4 animate-spin" />
            AI extracting quote…
          </div>
        )}
        {sent && (
          <span className="text-sm font-medium text-green-700">Completed · Buyer notified</span>
        )}
      </div>

      {/* ══════════════════════════════════
          STEP 1 — INPUT
      ══════════════════════════════════ */}
      {step !== "review" && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="font-semibold text-card-foreground">Paste or upload the supplier&apos;s quotation</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              WhatsApp screenshot, PDF, image, or just paste the text directly
            </p>
          </div>

          {/* Mode tabs */}
          <div className="flex border-b border-border">
            {([
              { mode: "paste",  label: "Screenshot / Image", icon: ClipboardPaste },
              { mode: "upload", label: "Upload File",         icon: Upload },
              { mode: "text",   label: "Paste Text",          icon: FileText },
            ] as const).map(({ mode, label, icon: Icon }) => (
              <button
                key={mode}
                onClick={() => {
                  setInputMode(mode);
                  files.forEach((sf) => { if (sf.previewUrl) URL.revokeObjectURL(sf.previewUrl); });
                  setFiles([]);
                  setTextInput("");
                }}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors border-b-2",
                  inputMode === mode
                    ? "border-blue-600 text-blue-600 bg-blue-50/50 dark:bg-blue-950/20"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          <div className="p-6 space-y-4">
            {/* ── Paste / Upload modes ── */}
            {(inputMode === "paste" || inputMode === "upload") && (
              <>
                {files.length > 0 ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      {files.map((sf, i) => (
                        <div key={i} className="relative group">
                          {sf.previewUrl ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={sf.previewUrl}
                              alt={`Quote page ${i + 1}`}
                              className="w-full h-32 object-cover rounded-xl border border-border bg-muted"
                            />
                          ) : (
                            <div className="w-full h-32 flex flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-muted/40 p-2">
                              <FileText className="w-7 h-7 text-red-400" />
                              <p className="text-xs text-muted-foreground truncate w-full text-center">{sf.file.name}</p>
                            </div>
                          )}
                          <span className="absolute bottom-1.5 left-1.5 text-[10px] font-medium bg-black/60 text-white rounded px-1.5 py-0.5">
                            {i + 1}
                          </span>
                          <button
                            onClick={() => removeFile(i)}
                            title="Remove"
                            className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center transition-colors"
                          >
                            <X className="w-3.5 h-3.5 text-white" />
                          </button>
                        </div>
                      ))}
                      {files.length < MAX_FILES && (
                        <button
                          onClick={() => inputMode === "upload" ? fileInputRef.current?.click() : handleClipboardButton()}
                          className="w-full h-32 border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center gap-1.5 text-muted-foreground hover:border-blue-400 hover:bg-blue-50/30 dark:hover:bg-blue-950/10 transition-colors"
                        >
                          <Plus className="w-5 h-5" />
                          <span className="text-xs font-medium">Add more</span>
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <ImageIcon className="w-3.5 h-3.5" />
                      {files.length} file{files.length > 1 ? "s" : ""} added
                      {files.length > 1 ? " — they'll be combined into a single quote when extracted." : ""}
                    </p>
                  </div>
                ) : (
                  <div
                    onClick={() => inputMode === "upload" ? fileInputRef.current?.click() : handleClipboardButton()}
                    className="border-2 border-dashed border-border rounded-xl p-10 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 dark:hover:bg-blue-950/10 transition-colors"
                  >
                    {inputMode === "paste" ? (
                      <>
                        <ClipboardPaste className="w-10 h-10 text-muted-foreground/50" />
                        <p className="font-medium text-muted-foreground">Click to paste from clipboard</p>
                        <p className="text-sm text-muted-foreground/60">Or press <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">Ctrl+V</kbd> anywhere on this page — paste multiple screenshots to combine them</p>
                      </>
                    ) : (
                      <>
                        <Upload className="w-10 h-10 text-muted-foreground/50" />
                        <p className="font-medium text-muted-foreground">Click to upload file(s)</p>
                        <p className="text-sm text-muted-foreground/60">PDF, image (JPG/PNG), Excel, or text — select multiple to combine them</p>
                      </>
                    )}
                  </div>
                )}

                {inputMode === "paste" && files.length === 0 && (
                  <button
                    onClick={handleClipboardButton}
                    className="w-full flex items-center justify-center gap-2 bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/20 dark:hover:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 font-medium text-sm rounded-xl py-3 transition-colors"
                  >
                    <ClipboardPaste className="w-4 h-4" />
                    Paste screenshot from clipboard
                    <span className="text-purple-400 text-xs font-normal">(Ctrl+V)</span>
                  </button>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.csv,.txt"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </>
            )}

            {/* ── Text mode ── */}
            {inputMode === "text" && (
              <div className="space-y-2">
                <Label>Paste the supplier&apos;s quote text here</Label>
                <Textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder={"e.g.\nDrill Machine 13mm — ₹1,250/pc × 5 nos\nAngle Grinder 4\" — ₹980/pc × 10 nos\nDelivery: 3 days\nPayment: 50% advance"}
                  className="min-h-48 font-mono text-sm resize-y"
                />
                <p className="text-xs text-muted-foreground">
                  Supports any format — WhatsApp text, typed list, or copied table
                </p>
              </div>
            )}

            <Button
              onClick={handleExtract}
              disabled={!canExtract || step === "extracting"}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold h-11"
            >
              {step === "extracting" ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-2" />Extracting with AI…</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-2" />Extract & Draft Email</>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════
          STEP 2 — REVIEW & SEND
      ══════════════════════════════════ */}
      {step === "review" && quote && (
        <>
          {/* Extracted items table */}
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-card-foreground">Extracted Quote</h2>
                {quote.supplier_name && (
                  <p className="text-sm text-muted-foreground mt-0.5">Supplier: {quote.supplier_name}</p>
                )}
              </div>
              <button
                onClick={reset}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Start over
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground w-[38%]">Item</th>
                    <th className="text-left px-3 py-2.5 font-medium text-muted-foreground w-[15%]">Qty</th>
                    <th className="text-left px-3 py-2.5 font-medium text-muted-foreground w-[15%]">Unit</th>
                    <th className="text-left px-3 py-2.5 font-medium text-muted-foreground w-[18%]">Unit Price (₹)</th>
                    <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => (
                    <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-2">
                        <input
                          value={item.name}
                          onChange={(e) => updateItem(i, "name", e.target.value)}
                          className="w-full bg-transparent text-card-foreground focus:outline-none focus:bg-accent rounded px-1 py-0.5"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={item.qty ?? ""}
                          onChange={(e) => updateItem(i, "qty", e.target.value ? Number(e.target.value) : null)}
                          className="w-full bg-transparent focus:outline-none focus:bg-accent rounded px-1 py-0.5 text-muted-foreground"
                          placeholder="—"
                          type="number"
                          min={0}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={item.unit ?? ""}
                          onChange={(e) => updateItem(i, "unit", e.target.value || null)}
                          className="w-full bg-transparent focus:outline-none focus:bg-accent rounded px-1 py-0.5 text-muted-foreground"
                          placeholder="pcs"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={item.unit_price ?? ""}
                          onChange={(e) => updateItem(i, "unit_price", e.target.value ? Number(e.target.value) : null)}
                          className="w-full bg-transparent focus:outline-none focus:bg-accent rounded px-1 py-0.5 text-muted-foreground"
                          placeholder="—"
                          type="number"
                          min={0}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={item.notes ?? ""}
                          onChange={(e) => updateItem(i, "notes", e.target.value || null)}
                          className="w-full bg-transparent focus:outline-none focus:bg-accent rounded px-1 py-0.5 text-muted-foreground"
                          placeholder="—"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {(quote.delivery_days || quote.payment_terms || quote.validity_days) && (
              <div className="px-6 py-3 bg-muted/20 border-t border-border flex flex-wrap gap-4 text-sm text-muted-foreground">
                {quote.delivery_days  && <span>🚚 Delivery: <b className="text-card-foreground">{quote.delivery_days} days</b></span>}
                {quote.payment_terms  && <span>💳 Payment: <b className="text-card-foreground">{quote.payment_terms}</b></span>}
                {quote.validity_days  && <span>⏳ Valid for: <b className="text-card-foreground">{quote.validity_days} days</b></span>}
              </div>
            )}
          </div>

          {/* Email compose */}
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold text-card-foreground">Compose Email to Buyer</h2>
              <button
                onClick={rebuildEmailBody}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-2.5 py-1.5 hover:bg-accent transition-colors"
              >
                <Pencil className="w-3 h-3" />
                Sync edits to body
              </button>
            </div>

            {sent ? (
              <div className="px-6 py-8 space-y-4">
                <div className="flex flex-col items-center gap-2 text-center">
                  <CheckCircle2 className="w-10 h-10 text-green-500" />
                  <p className="text-lg font-semibold text-card-foreground">Completed · Buyer notified</p>
                  <p className="text-sm text-muted-foreground">
                    <b>{toEmail}</b>
                    {sentAt && (
                      <> · {new Date(sentAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSentDetailsOpen((o) => !o)}
                  className="w-full flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground py-1"
                >
                  {sentDetailsOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  {sentDetailsOpen ? "Hide summary" : "View quote & message sent"}
                </button>
                {sentDetailsOpen && quote && (
                  <div className="border-t border-border pt-4">
                    <RfqLifecycleExpand
                      buyerLog={{
                        id: "local",
                        buyer_email: toEmail,
                        supplier_name: quote.supplier_name,
                        quote_summary: {
                          supplier_name: quote.supplier_name,
                          items,
                          delivery_days: quote.delivery_days,
                          payment_terms: quote.payment_terms,
                          validity_days: quote.validity_days,
                        },
                        email_subject: subject,
                        email_body: body,
                        sent_at: sentAt ?? new Date().toISOString(),
                      }}
                    />
                  </div>
                )}
                <Button variant="outline" onClick={reset} className="w-full">
                  Send another reply
                </Button>
              </div>
            ) : (
              <div className="p-6 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="to">To <span className="text-destructive">*</span></Label>
                  <Input
                    id="to"
                    type="email"
                    placeholder="buyer@example.com"
                    value={toEmail}
                    onChange={(e) => setToEmail(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="subject">Subject <span className="text-destructive">*</span></Label>
                  <Input
                    id="subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Quotation for Your Enquiry"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="body">Email body <span className="text-destructive">*</span></Label>
                  <Textarea
                    id="body"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    className="min-h-64 text-sm font-mono resize-y"
                    placeholder="AI-drafted email will appear here…"
                  />
                  <p className="text-xs text-muted-foreground">Edit freely before sending. Sent via your connected Gmail account.</p>
                </div>

                <Button
                  onClick={handleSend}
                  disabled={sending || !toEmail || !subject || !body}
                  className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold h-11"
                >
                  {sending ? (
                    <><Loader2 className="w-4 h-4 animate-spin mr-2" />Sending…</>
                  ) : (
                    <><Send className="w-4 h-4 mr-2" />Send Email to Buyer</>
                  )}
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
