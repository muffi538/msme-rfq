"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, ClipboardPaste, Upload, FileText, ImageIcon,
  Sparkles, Send, CheckCircle2, X, Pencil, RotateCcw, Plus, FolderOpen, Save,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExtractedQuote, QuoteItem } from "@/app/api/rfq-reply/extract/route";
import { RfqWorkflowTracker } from "@/components/dashboard/RfqWorkflowTracker";
import { RfqLifecycleExpand } from "@/components/dashboard/RfqLifecycleExpand";
import { WORKFLOW_STEPS, type WorkflowStepView } from "@/lib/rfq-lifecycle";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ImportRfqModal, type ImportableRfq } from "@/components/dashboard/ImportRfqModal";
import { QuotationItemsTable, type QuotationTableItem, computeQuotationTotals } from "@/components/dashboard/QuotationItemsTable";
import { buildQuotationPdfBlob } from "@/lib/exportRfqItems";
import { createClient } from "@/lib/supabase/client";

type Step = "input" | "extracting" | "review";

type LinkedRfq = {
  id: string; rfq_code: string; buyer_name: string | null; buyer_email: string | null; status: string;
};

// A quotation can arrive as several WhatsApp screenshots (a long price
// list split across screens) — must match MAX_FILES in
// src/app/api/rfq-reply/extract/route.ts.
const MAX_FILES = 6;

type StagedFile = { file: File; previewUrl: string | null };

export default function RfqReplyClient({ importableRfqs = [] }: { importableRfqs?: ImportableRfq[] }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

  // ── Input state ──
  const [inputMode, setInputMode]     = useState<"paste" | "upload" | "text" | "import">("paste");
  const [files, setFiles]             = useState<StagedFile[]>([]);
  const [textInput, setTextInput]     = useState("");

  // ── Flow state ──
  const [step, setStep]               = useState<Step>("input");
  const [quote, setQuote]             = useState<ExtractedQuote | null>(null);
  const [items, setItems]             = useState<QuoteItem[]>([]);

  // ── "Import Existing RFQ" state — a real rfq_id-linked quotation, distinct
  // from the AI-extracted `quote`/`items` above used by the other 3 modes. ──
  const [importModalOpen, setImportModalOpen]   = useState(false);
  const [importLoading, setImportLoading]       = useState(false);
  const [linkedRfq, setLinkedRfq]                 = useState<LinkedRfq | null>(null);
  const [quotationReplyId, setQuotationReplyId]   = useState<string | null>(null);
  const [quotationItems, setQuotationItems]       = useState<QuotationTableItem[]>([]);
  const [taxPercent, setTaxPercent]               = useState(0);
  const [headerDiscountPercent, setHeaderDiscountPercent] = useState(0);
  const [savingDraft, setSavingDraft]             = useState(false);

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
    setLinkedRfq(null);
    setQuotationReplyId(null);
    setQuotationItems([]);
    setTaxPercent(0);
    setHeaderDiscountPercent(0);
    setToEmail("");
    setSubject("");
    setBody("");
    setSent(false);
    setSentAt(null);
    setSentDetailsOpen(false);
  }

  // Deterministic, editable email draft for an imported RFQ — the other 3
  // modes call an AI extraction endpoint (parseQuote in extract/route.ts)
  // to compose their email since they're generating text FROM an unread
  // document; here the item list is already fully known (it's the RFQ's
  // own rfq_items), so there's nothing to extract — just a short cover
  // note. Deliberately carries NO computed pricing (no item list, no
  // total) — the PDF attached at send time is the single source of truth
  // for pricing, built fresh from live state; a number embedded in this
  // text would only be able to go stale the moment a price changes
  // afterward, which is exactly the bug this replaced (the body used to
  // list every item's rate and go stale the instant the table was edited).
  function buildDefaultQuotationEmail(rfq: LinkedRfq) {
    const greeting = rfq.buyer_name ? `Dear ${rfq.buyer_name},` : "Dear Sir/Madam,";
    return {
      subject: `Quotation for RFQ ${rfq.rfq_code}`,
      body: `${greeting}\n\nPlease find attached our quotation for RFQ ${rfq.rfq_code}, with pricing for every item requested.\n\nPlease let us know if you have any questions or would like to proceed.\n\nWarm regards`,
    };
  }

  async function handleImportSelect(rfqId: string) {
    setImportLoading(true);
    try {
      const res = await fetch(`/api/rfq-reply/quotation?rfqId=${rfqId}`);
      if (!res.ok) throw new Error("Could not load this RFQ");
      const data = await res.json() as {
        rfq: LinkedRfq & { gmail_message_id: string | null; gmail_thread_id: string | null };
        rfqItems: { id: string; line_number: number; name: string; qty: number | null; unit: string | null; spec: string | null; brand: string | null }[];
        draft: {
          id: string; tax_percent: number; discount_percent: number; email_subject: string | null; email_body: string | null;
          items: { item_id: string | null; line_number: number; name: string; qty: number | null; unit: string | null; spec: string | null; brand_offered: string | null; unit_price: number | null; discount_percent: number; lead_time: string | null; delivery_time: string | null; remarks: string | null }[];
        } | null;
        // Pricing carried over from the RFQ's most recently SENT quotation
        // (see /api/rfq-reply/quotation's GET route) — only present when
        // there's no active draft. Pre-fills the table from what was
        // priced last time instead of resetting to blank, but is NOT
        // treated as the draft itself: quotationReplyId stays null, so
        // saving/sending creates a fresh row rather than mutating the
        // already-sent record.
        lastSentItems: { item_id: string | null; line_number: number; name: string; qty: number | null; unit: string | null; spec: string | null; brand_offered: string | null; unit_price: number | null; discount_percent: number; lead_time: string | null; delivery_time: string | null; remarks: string | null }[] | null;
      };

      const sourceItems = data.draft?.items ?? data.lastSentItems;
      const tableItems: QuotationTableItem[] = sourceItems
        ? sourceItems.map((it) => ({
            _id: it.item_id ?? `row-${it.line_number}`,
            itemId: it.item_id, lineNumber: it.line_number, name: it.name, qty: it.qty, unit: it.unit,
            spec: it.spec, brandOffered: it.brand_offered, unitPrice: it.unit_price,
            discountPercent: it.discount_percent, leadTime: it.lead_time, deliveryTime: it.delivery_time, remarks: it.remarks,
          }))
        : data.rfqItems.map((it) => ({
            _id: it.id, itemId: it.id, lineNumber: it.line_number, name: it.name, qty: it.qty, unit: it.unit,
            spec: it.spec, brandOffered: it.brand, unitPrice: null,
            discountPercent: 0, leadTime: null, deliveryTime: null, remarks: null,
          }));

      setLinkedRfq(data.rfq);
      setQuotationItems(tableItems);
      setQuotationReplyId(data.draft?.id ?? null);
      setTaxPercent(data.draft?.tax_percent ?? 0);
      setHeaderDiscountPercent(data.draft?.discount_percent ?? 0);
      setToEmail(data.rfq.buyer_email ?? "");
      if (data.draft?.email_subject || data.draft?.email_body) {
        setSubject(data.draft.email_subject ?? "");
        setBody(data.draft.email_body ?? "");
      } else {
        const drafted = buildDefaultQuotationEmail(data.rfq);
        setSubject(drafted.subject);
        setBody(drafted.body);
      }
      setInputMode("import");
      setImportModalOpen(false);
      setStep("review");
      if (data.draft) toast.success("Resumed your saved draft for this RFQ");
      else if (data.lastSentItems) toast.success("Loaded pricing from the last quotation you sent for this RFQ — edit and resend.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load this RFQ");
    } finally {
      setImportLoading(false);
    }
  }

  async function saveQuotationDraft(): Promise<string | null> {
    if (!linkedRfq) return null;
    setSavingDraft(true);
    try {
      const res = await fetch("/api/rfq-reply/quotation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: quotationReplyId ?? undefined,
          rfqId: linkedRfq.id,
          source: "imported",
          buyerEmail: toEmail || linkedRfq.buyer_email || "",
          buyerName: linkedRfq.buyer_name,
          emailSubject: subject,
          emailBody: body,
          taxPercent,
          discountPercent: headerDiscountPercent,
          items: quotationItems.map((it) => ({
            itemId: it.itemId, lineNumber: it.lineNumber, name: it.name, qty: it.qty, unit: it.unit,
            spec: it.spec, brandOffered: it.brandOffered, unitPrice: it.unitPrice,
            discountPercent: it.discountPercent, leadTime: it.leadTime, deliveryTime: it.deliveryTime, remarks: it.remarks,
          })),
        }),
      });
      if (!res.ok) throw new Error("Could not save draft");
      const data = await res.json() as { id: string };
      setQuotationReplyId(data.id);
      return data.id;
    } catch {
      toast.error("Couldn't save draft — please try again");
      return null;
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleSaveDraftClick() {
    const id = await saveQuotationDraft();
    if (id) toast.success("Draft saved — you can come back to it any time from Import Existing RFQ.");
  }

  async function handleSendQuotation() {
    if (!linkedRfq || !toEmail || !subject || !body) {
      toast.error("Recipient email, subject and body are required");
      return;
    }
    setSending(true);
    try {
      const id = await saveQuotationDraft();
      if (!id) { setSending(false); return; }

      // Best-effort attachment — a PDF-generation or upload failure must
      // never block the email itself from sending. The send route always
      // falls back to a plain-text price list when there's no attachment
      // (see /api/rfq-reply/quotation/send), so the buyer still gets full
      // pricing either way; these toasts just surface WHY early.
      let attachmentPath: string | null = null;
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { grandTotal, subtotal, taxAmount } = computeQuotationTotals(quotationItems, headerDiscountPercent, taxPercent);
          const blob = buildQuotationPdfBlob(
            { rfq_code: linkedRfq.rfq_code, buyer_name: linkedRfq.buyer_name, currency: "INR", subtotal, tax_percent: taxPercent, tax_amount: taxAmount, grand_total: grandTotal },
            quotationItems.map((it) => ({
              line_number: it.lineNumber, name: it.name, qty: it.qty, unit: it.unit, unit_price: it.unitPrice,
              discount_percent: it.discountPercent, line_total: (it.qty ?? 0) * (it.unitPrice ?? 0) * (1 - it.discountPercent / 100),
              brand_offered: it.brandOffered, lead_time: it.leadTime,
            }))
          );
          const path = `${user.id}/quotations/${id}.pdf`;
          const { error: uploadError } = await supabase.storage.from("rfq-files").upload(path, blob, { upsert: true, contentType: "application/pdf" });
          if (uploadError) {
            toast.warning("Could not attach the quotation PDF — sending without it.");
          } else {
            attachmentPath = path;
          }
        }
      } catch {
        toast.warning("Could not generate the quotation PDF — sending without it.");
      }

      const res = await fetch("/api/rfq-reply/quotation/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quotationReplyId: id, to: toEmail, subject, body, attachmentPath }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "Send failed");
      }
      const json = await res.json() as { sentAt?: string; threaded?: boolean; attached?: boolean };
      setSent(true);
      setSentAt(json.sentAt ?? new Date().toISOString());
      if (!json.attached) {
        // The send route always falls back to including an item-by-item
        // price list in the email text when the PDF didn't attach — the
        // buyer still gets full pricing either way, just not as a PDF.
        toast.warning("Sent — the PDF couldn't be attached, so pricing was included in the email text instead.");
      } else {
        toast.success(json.threaded ? "Buyer notified — replied within the original thread" : "Buyer notified successfully");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to send email");
    } finally {
      setSending(false);
    }
  }

  // A standalone/ad-hoc reply (Screenshot, Upload File, Paste Text — no
  // linked RFQ) has no real outgoing-supplier data or rfqs.status to
  // derive from, so this stays a local stand-in rather than the shared
  // computeWorkflowSteps — "Under Evaluation"/"Purchase Order" are always
  // pending here since there's no RFQ record to advance.
  function replyWorkflowSteps(): WorkflowStepView[] {
    const flags: Record<string, boolean> = {
      inquiry: true,
      supplier_sent: true,
      quotation_sent: step === "review" || sent,
      under_evaluation: false,
      po_received: false,
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
              { mode: "paste",  label: "Screenshot / Image",  icon: ClipboardPaste },
              { mode: "upload", label: "Upload File",          icon: Upload },
              { mode: "text",   label: "Paste Text",           icon: FileText },
              { mode: "import", label: "Import Existing RFQ",  icon: FolderOpen },
            ] as const).map(({ mode, label, icon: Icon }) => (
              <button
                key={mode}
                onClick={() => {
                  setInputMode(mode);
                  files.forEach((sf) => { if (sf.previewUrl) URL.revokeObjectURL(sf.previewUrl); });
                  setFiles([]);
                  setTextInput("");
                  if (mode === "import") setImportModalOpen(true);
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

            {/* ── Import Existing RFQ mode — no free text/file input; the
                modal (opened by the tab click, or the button below if it
                was dismissed) picks an RFQ and jumps straight to review. ── */}
            {inputMode === "import" && (
              <div
                onClick={() => setImportModalOpen(true)}
                className="border-2 border-dashed border-border rounded-xl p-10 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 dark:hover:bg-blue-950/10 transition-colors"
              >
                {importLoading ? (
                  <Loader2 className="w-10 h-10 text-muted-foreground/50 animate-spin" />
                ) : (
                  <FolderOpen className="w-10 h-10 text-muted-foreground/50" />
                )}
                <p className="font-medium text-muted-foreground">Browse RFQs already in Procur.AI</p>
                <p className="text-sm text-muted-foreground/60">Items, quantities, units and specs load automatically — just enter pricing</p>
              </div>
            )}

            {inputMode !== "import" && (
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
            )}
          </div>
        </div>
      )}

      {importModalOpen && (
        <ImportRfqModal
          rfqs={importableRfqs}
          onSelect={handleImportSelect}
          onClose={() => setImportModalOpen(false)}
        />
      )}

      {/* ══════════════════════════════════
          STEP 2 — REVIEW & SEND
      ══════════════════════════════════ */}
      {step === "review" && quote && inputMode !== "import" && (
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

      {/* ══════════════════════════════════
          STEP 2 (Import mode) — QUOTATION TABLE & SEND
      ══════════════════════════════════ */}
      {step === "review" && inputMode === "import" && linkedRfq && (
        <>
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-card-foreground">Quotation for {linkedRfq.rfq_code}</h2>
                <p className="text-sm text-muted-foreground mt-0.5">{linkedRfq.buyer_name ?? "—"}</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSaveDraftClick}
                  disabled={savingDraft}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-accent transition-colors disabled:opacity-50"
                >
                  {savingDraft ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save Draft
                </button>
                <button
                  onClick={reset}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Start over
                </button>
              </div>
            </div>
            <div className="p-4">
              <QuotationItemsTable
                items={quotationItems}
                onItemsChange={setQuotationItems}
                taxPercent={taxPercent}
                onTaxPercentChange={setTaxPercent}
                discountPercent={headerDiscountPercent}
                onDiscountPercentChange={setHeaderDiscountPercent}
              />
            </div>
          </div>

          {/* Email compose */}
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-card-foreground">Compose Email to Buyer</h2>
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
                <Button variant="outline" onClick={reset} className="w-full">
                  Send another reply
                </Button>
              </div>
            ) : (
              <div className="p-6 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="import-to">To <span className="text-destructive">*</span></Label>
                  <Input
                    id="import-to"
                    type="email"
                    placeholder="buyer@example.com"
                    value={toEmail}
                    onChange={(e) => setToEmail(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="import-subject">Subject <span className="text-destructive">*</span></Label>
                  <Input
                    id="import-subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Quotation for Your Enquiry"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="import-body">Email body <span className="text-destructive">*</span></Label>
                  <Textarea
                    id="import-body"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    className="min-h-64 text-sm font-mono resize-y"
                  />
                  <p className="text-xs text-muted-foreground">Edit freely before sending. Sent via your connected Gmail account — replies within the original thread when possible.</p>
                </div>

                <Button
                  onClick={handleSendQuotation}
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
