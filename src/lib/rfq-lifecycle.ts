export const WORKFLOW_STEPS = [
  { id: "inquiry",         label: "Inquiry Received", short: "Inquiry" },
  { id: "supplier_sent",   label: "Supplier Sent",    short: "Supplier" },
  { id: "quote_received",  label: "Quote Received",   short: "Quote" },
  { id: "buyer_notified",  label: "Buyer Notified",   short: "Buyer" },
] as const;

export type WorkflowStepId = (typeof WORKFLOW_STEPS)[number]["id"];
export type StepState = "completed" | "current" | "pending";

export type WorkflowStepView = {
  id: WorkflowStepId;
  label: string;
  short: string;
  state: StepState;
};

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

export type OutgoingStats = { total: number; sent: number };

export function matchBuyerReplyLog(
  buyerEmail: string | null | undefined,
  logs: BuyerReplyLog[],
): BuyerReplyLog | null {
  if (!buyerEmail?.trim()) return null;
  const key = buyerEmail.trim().toLowerCase();
  return logs.find((l) => l.buyer_email.trim().toLowerCase() === key) ?? null;
}

export function computeWorkflowSteps(
  outgoing: OutgoingStats,
  buyerLog: BuyerReplyLog | null,
): WorkflowStepView[] {
  const flags: Record<WorkflowStepId, boolean> = {
    inquiry: true,
    supplier_sent: outgoing.sent > 0,
    quote_received: !!buyerLog,
    buyer_notified: !!buyerLog,
  };

  const order = WORKFLOW_STEPS.map((s) => s.id);
  const allComplete = order.every((id) => flags[id]);
  let currentId: WorkflowStepId = "buyer_notified";
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
