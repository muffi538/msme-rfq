"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, ClipboardPaste, Upload, FileText, ImageIcon,
  Sparkles, Send, CheckCircle2, X, Pencil, RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExtractedQuote, QuoteItem } from "@/app/api/rfq-reply/extract/route";

type Step = "input" | "extracting" | "review";

export default function RfqReplyClient() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Input state ──
  const [inputMode, setInputMode]     = useState<"paste" | "upload" | "text">("paste");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [file, setFile]               = useState<File | null>(null);
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

  // ── Clipboard paste (Ctrl+V anywhere) ──
  const handlePaste = useCallback((e: ClipboardEvent) => {
    if (step !== "input") return;
    const clipItems = e.clipboardData?.items;
    if (!clipItems) return;
    for (const item of Array.from(clipItems)) {
      if (item.type.startsWith("image/")) {
        const blob = item.getAsFile();
        if (!blob) continue;
        const f = new File([blob], `paste-${Date.now()}.png`, { type: blob.type });
        setFile(f);
        setImagePreview(URL.createObjectURL(f));
        setInputMode("paste");
        toast.success("Screenshot pasted — hit Extract to process it");
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
          setFile(f);
          setImagePreview(URL.createObjectURL(f));
          setInputMode("paste");
          toast.success("Screenshot pasted!");
          return;
        }
      }
      toast.error("No image in clipboard. Copy a WhatsApp screenshot first.");
    } catch {
      toast.error("Could not read clipboard — try pressing Ctrl+V instead.");
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setImagePreview(f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
    setInputMode("upload");
    e.target.value = "";
  }

  function reset() {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setFile(null);
    setImagePreview(null);
    setTextInput("");
    setInputMode("paste");
    setStep("input");
    setQuote(null);
    setItems([]);
    setToEmail("");
    setSubject("");
    setBody("");
    setSent(false);
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
        if (!file) { toast.error("No file to process"); setStep("input"); return; }
        const form = new FormData();
        form.append("file", file);
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
        body: JSON.stringify({ to: toEmail, subject, body }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "Send failed");
      }
      setSent(true);
      toast.success("Email sent successfully!");
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
    ((inputMode === "paste" || inputMode === "upload") && !!file);

  return (
    <div className="max-w-3xl mx-auto space-y-6">

      {/* ── Step indicator ── */}
      <div className="flex items-center gap-3 text-sm">
        {(["input", "review"] as const).map((s, i) => (
          <div key={s} className="flex items-center gap-3">
            {i > 0 && <div className={cn("h-px w-8", step === "input" ? "bg-border" : "bg-blue-600")} />}
            <div className={cn(
              "flex items-center gap-2 font-medium",
              step === s ? "text-blue-600" : step === "review" && s === "input" ? "text-muted-foreground" : "text-muted-foreground"
            )}>
              <span className={cn(
                "w-6 h-6 rounded-full text-xs flex items-center justify-center font-bold",
                step === s ? "bg-blue-600 text-white" : s === "input" && step === "review" ? "bg-green-500 text-white" : "bg-muted text-muted-foreground"
              )}>
                {s === "input" && step === "review" ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
              </span>
              {s === "input" ? "Supplier Quote" : "Review & Send"}
            </div>
          </div>
        ))}
        {step === "extracting" && (
          <div className="ml-auto flex items-center gap-2 text-blue-600 font-medium">
            <Loader2 className="w-4 h-4 animate-spin" />
            AI extracting quote…
          </div>
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
                onClick={() => { setInputMode(mode); setFile(null); setImagePreview(null); setTextInput(""); }}
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
                {imagePreview ? (
                  <div className="relative group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imagePreview}
                      alt="Quote preview"
                      className="w-full max-h-80 object-contain rounded-xl border border-border bg-muted"
                    />
                    <button
                      onClick={() => { if (imagePreview) URL.revokeObjectURL(imagePreview); setFile(null); setImagePreview(null); }}
                      className="absolute top-2 right-2 w-7 h-7 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center transition-colors"
                    >
                      <X className="w-3.5 h-3.5 text-white" />
                    </button>
                    <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                      <ImageIcon className="w-4 h-4" />
                      {file?.name}
                    </div>
                  </div>
                ) : file ? (
                  <div className="flex items-center gap-3 p-4 rounded-xl border border-border bg-muted/40">
                    <FileText className="w-8 h-8 text-red-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{file.name}</p>
                      <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>
                    </div>
                    <button onClick={() => setFile(null)} className="text-muted-foreground hover:text-destructive">
                      <X className="w-4 h-4" />
                    </button>
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
                        <p className="text-sm text-muted-foreground/60">Or press <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">Ctrl+V</kbd> anywhere on this page</p>
                      </>
                    ) : (
                      <>
                        <Upload className="w-10 h-10 text-muted-foreground/50" />
                        <p className="font-medium text-muted-foreground">Click to upload file</p>
                        <p className="text-sm text-muted-foreground/60">PDF, image (JPG/PNG), Excel, or text file</p>
                      </>
                    )}
                  </div>
                )}

                {inputMode === "paste" && !file && (
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
              <div className="px-6 py-12 flex flex-col items-center gap-3 text-center">
                <CheckCircle2 className="w-12 h-12 text-green-500" />
                <p className="text-lg font-semibold text-card-foreground">Email sent!</p>
                <p className="text-sm text-muted-foreground">The buyer at <b>{toEmail}</b> has been notified with the quotation.</p>
                <Button variant="outline" onClick={reset} className="mt-2">
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
