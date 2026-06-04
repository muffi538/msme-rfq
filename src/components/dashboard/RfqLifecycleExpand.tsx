"use client";

import type { BuyerReplyLog } from "@/lib/rfq-lifecycle";

export function RfqLifecycleExpand({ buyerLog }: { buyerLog: BuyerReplyLog | null }) {
  if (!buyerLog) {
    return (
      <p className="text-xs text-gray-400 py-1">
        No supplier quote or buyer notification recorded yet. Send supplier RFQs, then use RFQ Reply when the quote arrives.
      </p>
    );
  }

  const summary = buyerLog.quote_summary;
  const items = summary?.items ?? [];

  return (
    <div className="grid gap-3 text-xs">
      {summary && (
        <div>
          <p className="font-medium text-gray-500 mb-1">Supplier quote summary</p>
          {summary.supplier_name && (
            <p className="text-gray-700 mb-1">Supplier: {summary.supplier_name}</p>
          )}
          {items.length > 0 ? (
            <ul className="text-gray-600 space-y-0.5 max-h-32 overflow-y-auto">
              {items.slice(0, 12).map((item, i) => (
                <li key={i} className="truncate">
                  {item.name}
                  {item.qty != null && ` — ${item.qty}${item.unit ? ` ${item.unit}` : ""}`}
                  {item.unit_price != null && ` @ ₹${item.unit_price}`}
                </li>
              ))}
              {items.length > 12 && (
                <li className="text-gray-400">+{items.length - 12} more items</li>
              )}
            </ul>
          ) : (
            <p className="text-gray-400">Quote details not stored</p>
          )}
          {(summary.delivery_days || summary.payment_terms) && (
            <p className="text-gray-400 mt-1">
              {summary.delivery_days ? `Delivery: ${summary.delivery_days} days` : ""}
              {summary.delivery_days && summary.payment_terms ? " · " : ""}
              {summary.payment_terms ? `Payment: ${summary.payment_terms}` : ""}
            </p>
          )}
        </div>
      )}

      <div>
        <p className="font-medium text-gray-500 mb-1">Message sent to buyer</p>
        <p className="text-gray-600 font-medium">{buyerLog.email_subject}</p>
        <pre className="mt-1 text-gray-500 whitespace-pre-wrap font-sans leading-relaxed max-h-28 overflow-y-auto bg-white rounded-lg border border-gray-100 p-2">
          {buyerLog.email_body}
        </pre>
      </div>

      <p className="text-gray-400">
        Buyer notified:{" "}
        <span className="text-gray-600">
          {new Date(buyerLog.sent_at).toLocaleString("en-IN", {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </span>
      </p>
    </div>
  );
}
