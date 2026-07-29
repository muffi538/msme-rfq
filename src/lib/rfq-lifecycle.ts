export const WORKFLOW_STEPS = [
  { id: "inquiry",           label: "Inquiry Received",  short: "Inquiry" },
  { id: "supplier_sent",     label: "Supplier Sent",     short: "Supplier" },
  { id: "quotation_sent",    label: "Quotation Sent",    short: "Quotation" },
  { id: "under_evaluation",  label: "Under Evaluation",  short: "Evaluation" },
  { id: "po_received",       label: "Purchase Order",    short: "PO" },
] as const;

export type WorkflowStepId = (typeof WORKFLOW_STEPS)[number]["id"];
export type StepState = "completed" | "current" | "pending";

export type WorkflowStepView = {
  id: WorkflowStepId;
  label: string;
  short: string;
  state: StepState;
};

// Legacy, unlinked quotation record — an RFQ Reply sent before this RFQ was
// ever tied to it by rfq_id (or sent via the external Screenshot/Upload/
// Paste modes, which still don't require picking an RFQ). Matched to an RFQ
// only by buyer_email, so two RFQs sharing a buyer email can collide onto
// the same log — kept only as a fallback for replies that predate/skip
// quotation_replies linkage; see matchQuotationReply below for the real,
// unambiguous rfq_id-based match.
export type BuyerReplyLog = {
  id: string;
  buyer_email: string;
  supplier_name: string | null;
  quote_summary: {
    supplier_name?: string | null;
    items?: { name: string; qty: number | null; unit: string | null; unit_price: number | null; notes?: string | null }[];
    delivery_days?: number | null;
    payment_terms?: string | null;
    validity_days?: number | null;
  } | null;
  email_subject: string;
  email_body: string;
  sent_at: string;
};

// A real quotation reply, linked to its RFQ via rfq_id — unambiguous,
// unlike BuyerReplyLog's email-string matching above.
export type QuotationReplySummary = {
  id: string;
  rfq_id: string | null;
  status: "draft" | "sent";
  buyer_email: string;
  supplier_name: string | null;
  email_subject: string | null;
  email_body: string | null;
  grand_total: number;
  sent_at: string | null;
};

export type OutgoingStats = { total: number; sent: number };

export function matchBuyerReplyLog(
  buyerEmail: string | null | undefined,
  logs: BuyerReplyLog[],
): BuyerReplyLog | null {
  if (!buyerEmail?.trim()) return null;
  const key = buyerEmail.trim().toLowerCase();
  return logs.find((l) => l.buyer_email.trim().toLowerCase() === key) ?? null;
}

// Most-recently-sent quotation_replies row actually linked to this RFQ —
// the real, non-ambiguous signal (see BuyerReplyLog's comment for why the
// old email-matching approach could collide across RFQs).
export function matchQuotationReply(
  rfqId: string,
  replies: QuotationReplySummary[],
): QuotationReplySummary | null {
  const sent = replies.filter((r) => r.rfq_id === rfqId && r.status === "sent");
  if (sent.length === 0) return null;
  return sent.reduce((latest, r) => (!latest.sent_at || (r.sent_at && r.sent_at > latest.sent_at) ? r : latest));
}

// `rfqStatus` drives the last two stages directly (they're user-reported
// checkpoints — this app has no way to automatically detect that a buyer is
// "evaluating" a quote or has actually cut a PO, so advancing past
// "Quotation Sent" is always an explicit action, never inferred).
export function computeWorkflowSteps(
  outgoing: OutgoingStats,
  quotationSent: boolean,
  rfqStatus: string,
): WorkflowStepView[] {
  const flags: Record<WorkflowStepId, boolean> = {
    inquiry: true,
    supplier_sent: outgoing.sent > 0,
    quotation_sent: quotationSent || rfqStatus === "under_evaluation" || rfqStatus === "po_received",
    under_evaluation: rfqStatus === "under_evaluation" || rfqStatus === "po_received",
    po_received: rfqStatus === "po_received",
  };

  const order = WORKFLOW_STEPS.map((s) => s.id);
  const allComplete = order.every((id) => flags[id]);
  let currentId: WorkflowStepId = "po_received";
  for (const id of order) {
    if (!flags[id]) {
      currentId = id;
      break;
    }
  }

  return WORKFLOW_STEPS.map((step) => ({
    ...step,
    state: flags[step.id]
      ? "completed"
      : !allComplete && step.id === currentId
        ? "current"
        : "pending",
  }));
}

export function isWorkflowComplete(steps: WorkflowStepView[]): boolean {
  return steps.every((s) => s.state === "completed");
}

export function aggregateOutgoingByRfq(
  rows: { rfq_id: string; status: string }[],
): Record<string, OutgoingStats> {
  const map: Record<string, OutgoingStats> = {};
  for (const row of rows) {
    if (!map[row.rfq_id]) map[row.rfq_id] = { total: 0, sent: 0 };
    map[row.rfq_id].total += 1;
    if (row.status === "sent") map[row.rfq_id].sent += 1;
  }
  return map;
}
