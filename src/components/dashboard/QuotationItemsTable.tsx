"use client";

import { memo, useMemo } from "react";
import { Lock } from "lucide-react";

export type QuotationTableItem = {
  _id: string;
  itemId: string | null;
  lineNumber: number;
  name: string;
  qty: number | null;
  unit: string | null;
  spec: string | null;
  brandOffered: string | null;
  unitPrice: number | null;
  discountPercent: number;
  leadTime: string | null;
  deliveryTime: string | null;
  remarks: string | null;
};

export function lineTotal(item: QuotationTableItem): number {
  const qty = item.qty ?? 0;
  const price = item.unitPrice ?? 0;
  return Math.round((qty * price * (1 - item.discountPercent / 100) + Number.EPSILON) * 100) / 100;
}

export function computeQuotationTotals(items: QuotationTableItem[], headerDiscountPercent: number, taxPercent: number) {
  const subtotal = Math.round((items.reduce((sum, it) => sum + lineTotal(it), 0) + Number.EPSILON) * 100) / 100;
  const discounted = Math.round((subtotal * (1 - headerDiscountPercent / 100) + Number.EPSILON) * 100) / 100;
  const taxAmount = Math.round((discounted * (taxPercent / 100) + Number.EPSILON) * 100) / 100;
  const grandTotal = Math.round((discounted + taxAmount + Number.EPSILON) * 100) / 100;
  return { subtotal, discounted, taxAmount, grandTotal };
}

function fmt(n: number, currency: string) {
  return `${currency} ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type EditableField = "unitPrice" | "discountPercent" | "leadTime" | "deliveryTime" | "brandOffered" | "remarks";

// Memoized so editing one row's input only re-renders that row's <tr> —
// matters once a quotation has 100+ items, where re-rendering the whole
// table's DOM on every keystroke would be visibly laggy.
const Row = memo(function Row({
  item, currency, onEdit,
}: {
  item: QuotationTableItem;
  currency: string;
  onEdit: (id: string, field: EditableField, value: string | number | null) => void;
}) {
  const total = lineTotal(item);
  return (
    <tr className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
      <td className="px-3 py-2 text-gray-400 text-xs">{item.lineNumber}</td>
      <td className="px-3 py-2">
        <p className="font-medium text-gray-800">{item.name}</p>
        {item.spec && <p className="text-xs text-gray-400">{item.spec}</p>}
      </td>
      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{item.qty ?? "—"}</td>
      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{item.unit ?? "—"}</td>
      <td className="px-2 py-2">
        <input
          type="number" min={0}
          value={item.unitPrice ?? ""}
          onChange={(e) => onEdit(item._id, "unitPrice", e.target.value ? Number(e.target.value) : null)}
          placeholder="Enter price"
          className="w-24 bg-transparent border border-transparent hover:border-gray-200 focus:border-blue-400 focus:outline-none rounded px-1.5 py-1 text-right"
        />
      </td>
      <td className="px-2 py-2">
        <input
          type="number" min={0} max={100}
          value={item.discountPercent || ""}
          onChange={(e) => onEdit(item._id, "discountPercent", e.target.value ? Number(e.target.value) : 0)}
          placeholder="0"
          className="w-14 bg-transparent border border-transparent hover:border-gray-200 focus:border-blue-400 focus:outline-none rounded px-1.5 py-1 text-right"
        />
      </td>
      <td className="px-2 py-2">
        <input
          value={item.brandOffered ?? ""}
          onChange={(e) => onEdit(item._id, "brandOffered", e.target.value || null)}
          placeholder="—"
          className="w-24 bg-transparent border border-transparent hover:border-gray-200 focus:border-blue-400 focus:outline-none rounded px-1.5 py-1"
        />
      </td>
      <td className="px-2 py-2">
        <input
          value={item.leadTime ?? ""}
          onChange={(e) => onEdit(item._id, "leadTime", e.target.value || null)}
          placeholder="—"
          className="w-20 bg-transparent border border-transparent hover:border-gray-200 focus:border-blue-400 focus:outline-none rounded px-1.5 py-1"
        />
      </td>
      <td className="px-2 py-2">
        <input
          value={item.deliveryTime ?? ""}
          onChange={(e) => onEdit(item._id, "deliveryTime", e.target.value || null)}
          placeholder="—"
          className="w-20 bg-transparent border border-transparent hover:border-gray-200 focus:border-blue-400 focus:outline-none rounded px-1.5 py-1"
        />
      </td>
      <td className="px-2 py-2">
        <input
          value={item.remarks ?? ""}
          onChange={(e) => onEdit(item._id, "remarks", e.target.value || null)}
          placeholder="—"
          className="w-24 bg-transparent border border-transparent hover:border-gray-200 focus:border-blue-400 focus:outline-none rounded px-1.5 py-1"
        />
      </td>
      <td className="px-3 py-2 text-right font-medium text-gray-800 whitespace-nowrap">
        {fmt(total, currency)}
      </td>
    </tr>
  );
});

// Spreadsheet-like editable quotation table for "Import Existing RFQ".
// Product/Qty/Unit/Spec are always read-only display (source of truth is
// the linked rfq_items row — the whole point of importing instead of
// re-uploading a document); Unit Price/Discount/Brand/Lead Time/Delivery
// Time/Remarks are editable. Preserves order via lineNumber (never
// resorted). The 3 external modes (Screenshot/Upload/Paste) keep their own
// existing table in RfqReplyClient, where name/qty/unit stay editable
// since they come from imperfect AI extraction of someone else's document,
// not a known RFQ record — this component is not used there.
export function QuotationItemsTable({
  items,
  onItemsChange,
  currency = "₹",
  taxPercent,
  onTaxPercentChange,
  discountPercent,
  onDiscountPercentChange,
}: {
  items: QuotationTableItem[];
  onItemsChange: (items: QuotationTableItem[]) => void;
  currency?: string;
  taxPercent: number;
  onTaxPercentChange: (n: number) => void;
  discountPercent: number;
  onDiscountPercentChange: (n: number) => void;
}) {
  const totals = useMemo(() => computeQuotationTotals(items, discountPercent, taxPercent), [items, discountPercent, taxPercent]);
  const missingPriceCount = useMemo(() => items.filter((i) => i.unitPrice == null).length, [items]);

  function onEdit(id: string, field: EditableField, value: string | number | null) {
    onItemsChange(items.map((it) => it._id === id ? { ...it, [field]: value } : it));
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60 text-left text-xs text-gray-500 uppercase tracking-wide">
              <th className="px-3 py-2 w-8">#</th>
              <th className="px-3 py-2 min-w-[160px]">Product</th>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2">Unit</th>
              <th className="px-2 py-2 min-w-[100px]">Unit Price</th>
              <th className="px-2 py-2 min-w-[70px]">Disc. %</th>
              <th className="px-2 py-2 min-w-[100px]">Brand Offered</th>
              <th className="px-2 py-2 min-w-[90px]">Lead Time</th>
              <th className="px-2 py-2 min-w-[90px]">Delivery Time</th>
              <th className="px-2 py-2 min-w-[100px]">Remarks</th>
              <th className="px-3 py-2 text-right min-w-[100px]">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <Row key={item._id} item={item} currency={currency} onEdit={onEdit} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="px-4 py-2 text-[11px] text-gray-400 border-t border-gray-50 flex items-center gap-1.5">
        <Lock className="w-3 h-3" /> Product, qty, unit, and spec are locked to the imported RFQ — only pricing fields are editable.
      </p>

      <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/40 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-end gap-4">
          <div className="space-y-1">
            <label className="text-xs text-gray-500">Overall discount %</label>
            <input
              type="number" min={0} max={100}
              value={discountPercent || ""}
              onChange={(e) => onDiscountPercentChange(e.target.value ? Number(e.target.value) : 0)}
              placeholder="0"
              className="w-20 h-8 text-sm border border-gray-200 rounded-lg px-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-gray-500">Tax %</label>
            <input
              type="number" min={0} max={100}
              value={taxPercent || ""}
              onChange={(e) => onTaxPercentChange(e.target.value ? Number(e.target.value) : 0)}
              placeholder="0"
              className="w-20 h-8 text-sm border border-gray-200 rounded-lg px-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {missingPriceCount > 0 && (
            <p className="text-xs text-amber-600 pb-1.5">{missingPriceCount} item{missingPriceCount > 1 ? "s" : ""} still need{missingPriceCount === 1 ? "s" : ""} a price</p>
          )}
        </div>
        <div className="text-right space-y-0.5">
          <p className="text-xs text-gray-400">Subtotal: <span className="text-gray-600 font-medium">{fmt(totals.subtotal, currency)}</span></p>
          {discountPercent > 0 && (
            <p className="text-xs text-gray-400">After discount: <span className="text-gray-600 font-medium">{fmt(totals.discounted, currency)}</span></p>
          )}
          {taxPercent > 0 && (
            <p className="text-xs text-gray-400">Tax: <span className="text-gray-600 font-medium">{fmt(totals.taxAmount, currency)}</span></p>
          )}
          <p className="text-base font-semibold text-gray-900">Grand Total: {fmt(totals.grandTotal, currency)}</p>
        </div>
      </div>
    </div>
  );
}
