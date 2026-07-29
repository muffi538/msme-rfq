import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type ExportItem = {
  line_number: number; name: string; qty: number | null; unit: string | null;
  brand: string | null; spec: string | null; part_number?: string | null;
  category: string; delivery_details?: string | null; confidence?: number | null;
  colour?: string | null;
};

type ExportRfq = { rfq_code: string; buyer_name: string | null; source_rfq_number?: string | null };

function toRows(items: ExportItem[]) {
  return items.map((i) => ({
    "#":              i.line_number,
    "Item":           i.name,
    "Part / SKU":     i.part_number ?? "",
    "Qty":            i.qty ?? "",
    "Unit":           i.unit ?? "",
    "Brand":          i.brand ?? "",
    "Spec":           i.spec ?? "",
    "Colour":         i.colour ?? "",
    "Category":       i.category.replace(/_/g, " "),
    "Delivery":       i.delivery_details ?? "",
    "Confidence":     i.confidence != null ? `${Math.round(i.confidence * 100)}%` : "",
  }));
}

function buildSheet(rfq: ExportRfq, items: ExportItem[]) {
  const ws = XLSX.utils.json_to_sheet(toRows(items));
  ws["!cols"] = [{ wch: 4 }, { wch: 32 }, { wch: 14 }, { wch: 6 }, { wch: 8 }, { wch: 14 }, { wch: 24 }, { wch: 10 }, { wch: 18 }, { wch: 20 }, { wch: 10 }];
  return ws;
}

export function exportItemsToExcel(rfq: ExportRfq, items: ExportItem[]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSheet(rfq, items), "Items");
  XLSX.writeFile(wb, `${rfq.rfq_code}-items.xlsx`);
}

export function exportItemsToCsv(rfq: ExportRfq, items: ExportItem[]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSheet(rfq, items), "Items");
  XLSX.writeFile(wb, `${rfq.rfq_code}-items.csv`, { bookType: "csv" });
}

export function exportItemsToPdf(rfq: ExportRfq, items: ExportItem[]) {
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14);
  doc.text(`RFQ ${rfq.rfq_code}`, 14, 16);
  doc.setFontSize(10);
  const subtitle = [
    rfq.buyer_name ? `Buyer: ${rfq.buyer_name}` : null,
    rfq.source_rfq_number ? `Source RFQ #: ${rfq.source_rfq_number}` : null,
  ].filter(Boolean).join("   |   ");
  if (subtitle) doc.text(subtitle, 14, 23);

  autoTable(doc, {
    startY: 28,
    head: [["#", "Item", "Part/SKU", "Qty", "Unit", "Brand", "Spec", "Colour", "Category", "Confidence"]],
    body: items.map((i) => [
      i.line_number,
      i.name,
      i.part_number ?? "",
      i.qty ?? "",
      i.unit ?? "",
      i.brand ?? "",
      i.spec ?? "",
      i.colour ?? "",
      i.category.replace(/_/g, " "),
      i.confidence != null ? `${Math.round(i.confidence * 100)}%` : "",
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [37, 99, 235] },
  });

  doc.save(`${rfq.rfq_code}-items.pdf`);
}

export type QuotationPdfItem = {
  line_number: number; name: string; qty: number | null; unit: string | null;
  unit_price: number | null; discount_percent: number; line_total: number;
  brand_offered: string | null; lead_time: string | null;
};

export type QuotationPdfHeader = {
  rfq_code?: string | null; buyer_name: string | null; supplier_name?: string | null;
  currency: string; subtotal: number; tax_percent: number; tax_amount: number;
  grand_total: number; validity_days?: number | null; payment_terms?: string | null;
};

// Same layout family as exportItemsToPdf above, but returns the PDF as a
// Blob (jsPDF's own doc.output("blob")) instead of triggering a browser
// download — used to attach a quotation as a real file on the reply email,
// which needs the bytes uploaded to storage and handed to a server route,
// not a client-side save-to-disk.
export function buildQuotationPdfBlob(header: QuotationPdfHeader, items: QuotationPdfItem[]): Blob {
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14);
  doc.text(`Quotation${header.rfq_code ? ` — ${header.rfq_code}` : ""}`, 14, 16);
  doc.setFontSize(10);
  const subtitle = [
    header.buyer_name ? `Buyer: ${header.buyer_name}` : null,
    header.supplier_name ? `Supplier: ${header.supplier_name}` : null,
  ].filter(Boolean).join("   |   ");
  if (subtitle) doc.text(subtitle, 14, 23);

  autoTable(doc, {
    startY: 28,
    head: [["#", "Item", "Qty", "Unit", "Unit Price", "Discount %", "Brand Offered", "Lead Time", "Line Total"]],
    body: items.map((i) => [
      i.line_number,
      i.name,
      i.qty ?? "",
      i.unit ?? "",
      i.unit_price != null ? `${header.currency} ${i.unit_price}` : "",
      i.discount_percent ? `${i.discount_percent}%` : "",
      i.brand_offered ?? "",
      i.lead_time ?? "",
      `${header.currency} ${i.line_total.toLocaleString("en-IN")}`,
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [37, 99, 235] },
  });

  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  doc.setFontSize(10);
  doc.text(`Subtotal: ${header.currency} ${header.subtotal.toLocaleString("en-IN")}`, 14, finalY);
  if (header.tax_percent) {
    doc.text(`Tax (${header.tax_percent}%): ${header.currency} ${header.tax_amount.toLocaleString("en-IN")}`, 14, finalY + 6);
  }
  doc.setFontSize(12);
  doc.text(`Grand Total: ${header.currency} ${header.grand_total.toLocaleString("en-IN")}`, 14, finalY + (header.tax_percent ? 14 : 8));
  doc.setFontSize(9);
  const terms = [
    header.validity_days ? `Valid for ${header.validity_days} days` : null,
    header.payment_terms ? `Payment: ${header.payment_terms}` : null,
  ].filter(Boolean).join("   |   ");
  if (terms) doc.text(terms, 14, finalY + (header.tax_percent ? 22 : 16));

  return doc.output("blob");
}
