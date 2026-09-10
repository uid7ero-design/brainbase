import 'server-only';
import { BRAND_INK, BRAND_PURPLE, BRAND_MUTED, BRAND_RULE, HEADER_BAND_FILL, HEADER_INK, HEADER_MUTED } from './quotePdf';
import { formatMoneyCents } from './money';
import { formatCommercialDate } from './dates';

// Phase C6.5 — Purchase Order PDF renderer. Structurally a close
// adaptation of lib/commercial/invoicePdf.ts's buildInvoicePdf(), reusing
// only the truly shared, non-domain-specific pieces (brand color
// constants imported from quotePdf.ts, money/date formatters) —
// mirroring this codebase's own established per-document-type-module
// convention (quotes.ts vs invoices.ts, quotePdf.ts vs invoicePdf.ts).
// quotePdf.ts/invoicePdf.ts are not modified by this file at all.
//
// DELIBERATE ARCHITECTURAL DIVERGENCE from quotePdf.ts/invoicePdf.ts:
// those two modules are deliberately ISOMORPHIC (no 'server-only', no
// fs/window reference) so the identical jsPDF-building code can run
// both in the browser (the quote/invoice detail pages' own client-side
// "Download PDF" buttons) and on the server (the email-attachment
// path). This module is instead SERVER-ONLY by design, per this
// gate's own explicit instruction — Purchasing exposes a real
// GET /api/commercial/purchase-orders/[id]/pdf route (a route neither
// quotes nor invoices have ever needed), so the client never needs to
// build a PDF itself; it only ever downloads the bytes that route
// returns. This keeps jsPDF out of the Purchasing client bundle
// entirely and makes the server route the single source of PDF
// generation — a stronger guarantee than the client-side-jsPDF
// precedent, not a weaker one.
//
// INVERTED FROM/TO relative to invoicePdf.ts: an invoice's "supplier"
// object is BrainBase's OWN business profile (the seller of goods/
// services), and "customer" is the third party. A purchase order is
// the exact opposite direction of trade — BrainBase (via its own
// business profile, named `buyer` below) is the PURCHASER, and the
// commercial_suppliers snapshot on the PO row is the actual outside
// vendor being paid. Naming reflects this explicitly (`buyer` /
// `PurchaseOrderPdfSupplier`) rather than reusing InvoicePdfSupplier's
// name for a semantically different party.
//
// CANCELLED TREATMENT — this gate's own explicit instruction: a
// cancelled PO must never be labelled VOID (the PO lifecycle has no
// VOID status; see lib/commercial/purchaseOrderLifecycle.ts). The
// watermark/callout/total-styling treatment below is a structural
// copy of invoicePdf.ts's VOID handling, wired to CANCELLED_RED
// instead and worded "CANCELLED" throughout, not "VOID".
const CANCELLED_RED = '#DC2626';

export interface PurchaseOrderPdfLine {
  description_snapshot: string;
  sku_snapshot: string | null;
  unit_snapshot: string | null;
  quantity: number;
  unit_price_cents: number;
  tax_code_snapshot: string | null;
  tax_rate_snapshot: string;
  line_total_cents: number;
  // cost_centre_id is deliberately NOT part of this interface — per
  // this gate's own Section D instruction, internal cost-centre
  // information must never appear on the supplier-facing PDF.
}

export interface PurchaseOrderPdfPurchaseOrder {
  purchase_order_number: string; // callers must only invoke this builder for ISSUED/CANCELLED, both of which always carry a permanent number
  status: 'ISSUED' | 'CANCELLED';
  currency: string;
  issued_at: string | Date | null;
  delivery_date: string | Date | null;
  delivery_address_line1: string | null;
  delivery_address_line2: string | null;
  delivery_suburb: string | null;
  delivery_state: string | null;
  delivery_postcode: string | null;
  delivery_country: string | null;
  payment_terms_days_snapshot: number | null;
  supplier_notes: string | null;
  // internal_notes is deliberately NOT part of this interface — never
  // rendered on the supplier-facing PDF.
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  supplier_name_snapshot: string | null;
  supplier_legal_name_snapshot: string | null;
  supplier_contact_name_snapshot: string | null;
  supplier_email_snapshot: string | null;
  supplier_phone_snapshot: string | null;
  supplier_address_snapshot: string | null;
  supplier_tax_business_number_snapshot: string | null;
  supplier_reference_snapshot: string | null;
  cancel_reason: string | null;
  cancelled_at: string | Date | null;
}

// The organisation ISSUING the PO — BrainBase's own business profile,
// resolved by the caller exactly like InvoicePdfSupplier's displayName
// (businessProfile.tradingName ?? organisation.name), never re-derived
// here.
export interface PurchaseOrderPdfBuyer {
  displayName: string;
  address: string | null;
  email: string | null;
  phone: string | null;
  abn: string | null;
}

export interface BuildPurchaseOrderPdfInput {
  purchaseOrder: PurchaseOrderPdfPurchaseOrder;
  lines: PurchaseOrderPdfLine[];
  buyer: PurchaseOrderPdfBuyer;
  // raw base64 (no "data:image/png;base64," prefix) PNG of the full
  // icon+wordmark lockup — see quotePdf.ts's own header for why this is
  // passed in rather than loaded inside this function.
  brandLockupBase64: string;
}

const PAGE_MARGIN = 18;
const BOTTOM_SAFE = 30;
const LOCKUP_ASPECT = 900 / 160;

export async function buildPurchaseOrderPdf({ purchaseOrder, lines, buyer, brandLockupBase64 }: BuildPurchaseOrderPdfInput): Promise<Uint8Array> {
  const jspdfMod = await import('jspdf');
  const JsPDF = (jspdfMod as unknown as { jsPDF?: unknown }).jsPDF ?? (jspdfMod as unknown as { default: unknown }).default;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = new (JsPDF as any)({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = PAGE_MARGIN;
  const isCancelled = purchaseOrder.status === 'CANCELLED';

  function ensureRoom(next: number) {
    if (y + next > pageH - BOTTOM_SAFE) {
      doc.addPage();
      y = PAGE_MARGIN;
    }
  }

  function drawCancelledWatermark() {
    doc.saveGraphicsState();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doc as any).setGState(new (doc as any).GState({ opacity: 0.14 }));
    doc.setTextColor(CANCELLED_RED);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(72);
    doc.text('CANCELLED', pageW / 2, pageH / 2, { align: 'center', angle: 35 });
    doc.restoreGraphicsState();
  }

  // ── Header — full-bleed dark band, matching quotePdf.ts/invoicePdf.ts's
  // own letterhead convention exactly. ────────────────────────────────
  doc.setFillColor(HEADER_BAND_FILL);
  doc.rect(0, 0, pageW, 32, 'F');

  const lockupW = 62;
  const lockupH = lockupW / LOCKUP_ASPECT;
  const lockupY = (32 - lockupH) / 2;
  doc.addImage(`data:image/png;base64,${brandLockupBase64}`, 'PNG', PAGE_MARGIN, lockupY, lockupW, lockupH);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(HEADER_INK);
  doc.text('PURCHASE ORDER', pageW - PAGE_MARGIN, 15, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(HEADER_MUTED);
  doc.text(purchaseOrder.purchase_order_number, pageW - PAGE_MARGIN, 22, { align: 'right' });

  y = 32 + 12;

  doc.setDrawColor(BRAND_RULE); doc.setLineWidth(0.4);
  doc.line(PAGE_MARGIN, y, pageW - PAGE_MARGIN, y);
  y += 10;

  // ── CANCELLED callout — first thing after the header, never buried,
  // matching invoicePdf.ts's own VOID callout placement exactly. ──────
  if (isCancelled) {
    ensureRoom(20);
    doc.setFillColor(254, 226, 226);
    doc.setDrawColor(CANCELLED_RED);
    doc.setLineWidth(0.6);
    doc.roundedRect(PAGE_MARGIN, y, pageW - PAGE_MARGIN * 2, purchaseOrder.cancel_reason ? 20 : 12, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(CANCELLED_RED);
    doc.text('THIS PURCHASE ORDER HAS BEEN CANCELLED — DO NOT FULFIL', PAGE_MARGIN + 5, y + 7.5);
    if (purchaseOrder.cancel_reason) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(BRAND_INK);
      const reasonLines: string[] = doc.splitTextToSize(`Reason: ${purchaseOrder.cancel_reason}`, pageW - PAGE_MARGIN * 2 - 10);
      doc.text(reasonLines[0], PAGE_MARGIN + 5, y + 14.5);
    }
    y += (purchaseOrder.cancel_reason ? 20 : 12) + 8;
  }

  // ── Buyer (BrainBase, issuing this PO) / Supplier (vendor) two-column
  // section — inverted labels relative to invoicePdf.ts's FROM/BILL TO,
  // since a purchase order's "us" is the buyer, not the seller. ───────
  const colW = (pageW - PAGE_MARGIN * 2 - 12) / 2;
  const leftX = PAGE_MARGIN;
  const rightX = PAGE_MARGIN + colW + 12;
  const sectionTop = y;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(BRAND_MUTED);
  doc.text('PURCHASER', leftX, y);
  doc.text('SUPPLIER', rightX, y);
  y += 5.5;

  let leftY = y;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(BRAND_INK);
  doc.text(buyer.displayName, leftX, leftY); leftY += 5.5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(BRAND_MUTED);
  if (buyer.address) { for (const l of doc.splitTextToSize(buyer.address, colW)) { doc.text(l, leftX, leftY); leftY += 4.6; } }
  if (buyer.email) { doc.text(buyer.email, leftX, leftY); leftY += 4.6; }
  if (buyer.phone) { doc.text(buyer.phone, leftX, leftY); leftY += 4.6; }
  if (buyer.abn) { doc.text(`ABN ${buyer.abn}`, leftX, leftY); leftY += 4.6; }

  let rightY = y;
  const supplierName = purchaseOrder.supplier_name_snapshot ?? '—';
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(BRAND_INK);
  doc.text(supplierName, rightX, rightY); rightY += 5.5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(BRAND_MUTED);
  if (purchaseOrder.supplier_legal_name_snapshot && purchaseOrder.supplier_legal_name_snapshot !== supplierName) {
    doc.text(purchaseOrder.supplier_legal_name_snapshot, rightX, rightY); rightY += 4.6;
  }
  if (purchaseOrder.supplier_contact_name_snapshot) { doc.text(purchaseOrder.supplier_contact_name_snapshot, rightX, rightY); rightY += 4.6; }
  if (purchaseOrder.supplier_address_snapshot) { for (const l of doc.splitTextToSize(purchaseOrder.supplier_address_snapshot, colW)) { doc.text(l, rightX, rightY); rightY += 4.6; } }
  if (purchaseOrder.supplier_email_snapshot) { doc.text(purchaseOrder.supplier_email_snapshot, rightX, rightY); rightY += 4.6; }
  if (purchaseOrder.supplier_phone_snapshot) { doc.text(purchaseOrder.supplier_phone_snapshot, rightX, rightY); rightY += 4.6; }
  if (purchaseOrder.supplier_tax_business_number_snapshot) { doc.text(`ABN/Tax No. ${purchaseOrder.supplier_tax_business_number_snapshot}`, rightX, rightY); rightY += 4.6; }
  if (purchaseOrder.supplier_reference_snapshot) { doc.text(`Supplier Ref: ${purchaseOrder.supplier_reference_snapshot}`, rightX, rightY); rightY += 4.6; }

  y = Math.max(leftY, rightY, sectionTop + 24) + 6;

  // ── PO details strip ─────────────────────────────────────────────
  doc.setFillColor(247, 247, 250);
  doc.roundedRect(PAGE_MARGIN, y, pageW - PAGE_MARGIN * 2, 16, 2, 2, 'F');
  const stripY = y + 10;
  const stripColW = (pageW - PAGE_MARGIN * 2) / 4;
  const details: [string, string][] = [
    ['PO NUMBER', purchaseOrder.purchase_order_number],
    ['ISSUE DATE', formatCommercialDate(purchaseOrder.issued_at)],
    ['DELIVERY DATE', purchaseOrder.delivery_date ? formatCommercialDate(purchaseOrder.delivery_date) : '—'],
    ['STATUS', purchaseOrder.status],
  ];
  details.forEach(([label, value], i) => {
    const x = PAGE_MARGIN + 5 + i * stripColW;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(BRAND_MUTED);
    doc.text(label, x, y + 5.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(isCancelled && label === 'STATUS' ? CANCELLED_RED : BRAND_INK);
    doc.text(value, x, stripY);
  });
  y += 24;

  // ── Delivery address / payment terms — only when present ───────────
  const deliveryAddressParts = [
    purchaseOrder.delivery_address_line1, purchaseOrder.delivery_address_line2,
    purchaseOrder.delivery_suburb, purchaseOrder.delivery_state, purchaseOrder.delivery_postcode,
    purchaseOrder.delivery_country,
  ].filter(Boolean);
  if (deliveryAddressParts.length > 0 || purchaseOrder.payment_terms_days_snapshot != null) {
    ensureRoom(14);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(BRAND_MUTED);
    doc.text('DELIVER TO', PAGE_MARGIN, y);
    y += 4.6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(BRAND_INK);
    if (deliveryAddressParts.length > 0) { doc.text(deliveryAddressParts.join(', '), PAGE_MARGIN, y); y += 4.6; }
    if (purchaseOrder.payment_terms_days_snapshot != null) {
      doc.setTextColor(BRAND_MUTED); doc.setFontSize(8.5);
      doc.text(`Payment terms: ${purchaseOrder.payment_terms_days_snapshot} days`, PAGE_MARGIN, y);
      y += 4.6;
    }
    y += 4;
  }

  // ── Line items ───────────────────────────────────────────────────
  const col = {
    desc: PAGE_MARGIN,
    qty: pageW - PAGE_MARGIN - 78,
    price: pageW - PAGE_MARGIN - 56,
    tax: pageW - PAGE_MARGIN - 28,
    total: pageW - PAGE_MARGIN,
  };

  function drawTableHeader() {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(BRAND_MUTED);
    doc.text('DESCRIPTION', col.desc, y);
    doc.text('QTY', col.qty, y, { align: 'right' });
    doc.text('UNIT PRICE', col.price, y, { align: 'right' });
    doc.text('TAX', col.tax, y, { align: 'right' });
    doc.text('LINE TOTAL', col.total, y, { align: 'right' });
    y += 3;
    doc.setDrawColor(BRAND_RULE);
    doc.line(PAGE_MARGIN, y, pageW - PAGE_MARGIN, y);
    y += 6;
  }
  drawTableHeader();

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(BRAND_INK);
  for (const line of lines) {
    const descLines: string[] = doc.splitTextToSize(line.description_snapshot, col.qty - col.desc - 6);
    const descHeight = descLines.length * 4.6;
    const skuHeight = line.sku_snapshot ? 4.6 : 0;
    const rowHeight = Math.max(descHeight + skuHeight, 6) + 3;
    ensureRoom(rowHeight);
    doc.text(descLines, col.desc, y);
    if (line.sku_snapshot) {
      doc.setFontSize(7.5); doc.setTextColor(BRAND_MUTED);
      doc.text(line.sku_snapshot, col.desc, y + descHeight);
      doc.setFontSize(9.5); doc.setTextColor(BRAND_INK);
    }
    doc.text(`${line.quantity}${line.unit_snapshot ? ` ${line.unit_snapshot}` : ''}`, col.qty, y, { align: 'right' });
    doc.text(formatMoneyCents(line.unit_price_cents, purchaseOrder.currency), col.price, y, { align: 'right' });
    doc.text(line.tax_code_snapshot ? `${line.tax_rate_snapshot}%` : '—', col.tax, y, { align: 'right' });
    doc.text(formatMoneyCents(line.line_total_cents, purchaseOrder.currency), col.total, y, { align: 'right' });
    y += rowHeight;
  }

  y += 3;
  doc.setDrawColor(BRAND_RULE);
  doc.line(pageW - PAGE_MARGIN - 80, y, pageW - PAGE_MARGIN, y);
  y += 8;

  // ── Totals — formats already-persisted, server-computed cents values
  // ONLY. Never derives/recomputes subtotal/tax/total here — that
  // arithmetic belongs exclusively to
  // lib/commercial/purchaseOrders.ts's recalculatePurchaseOrderTotals(),
  // which already runs server-side on every line mutation and once more
  // at issue time. ─────────────────────────────────────────────────
  ensureRoom(28);
  const totalLabelX = pageW - PAGE_MARGIN - 56;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(BRAND_MUTED);
  doc.text('Subtotal', totalLabelX, y);
  doc.text(formatMoneyCents(purchaseOrder.subtotal_cents, purchaseOrder.currency), col.total, y, { align: 'right' });
  y += 6;
  doc.text('GST / Tax', totalLabelX, y);
  doc.text(formatMoneyCents(purchaseOrder.tax_cents, purchaseOrder.currency), col.total, y, { align: 'right' });
  y += 8;
  doc.setDrawColor(BRAND_RULE);
  doc.line(totalLabelX, y - 4, pageW - PAGE_MARGIN, y - 4);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(isCancelled ? CANCELLED_RED : BRAND_INK);
  doc.text(isCancelled ? 'Total (Cancelled)' : 'Total', totalLabelX, y);
  doc.text(formatMoneyCents(purchaseOrder.total_cents, purchaseOrder.currency), col.total, y, { align: 'right' });
  y += 16;

  // ── Notes to Supplier ONLY — internal_notes is not part of
  // PurchaseOrderPdfPurchaseOrder at all, so there is nothing here that
  // could accidentally render it. ────────────────────────────────────
  if (purchaseOrder.supplier_notes) {
    ensureRoom(16);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(BRAND_INK); doc.text('Notes to Supplier', PAGE_MARGIN, y); y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(BRAND_MUTED);
    const notesLines: string[] = doc.splitTextToSize(purchaseOrder.supplier_notes, pageW - PAGE_MARGIN * 2);
    ensureRoom(notesLines.length * 4.4);
    doc.text(notesLines, PAGE_MARGIN, y);
    y += notesLines.length * 4.4;
  }

  // ── Cancellation footnote — cancelled date, shown near the bottom of
  // the body (the callout at the top already carries the reason). ────
  if (isCancelled && purchaseOrder.cancelled_at) {
    ensureRoom(10);
    y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(CANCELLED_RED);
    doc.text(`Cancelled ${formatCommercialDate(purchaseOrder.cancelled_at)}`, PAGE_MARGIN, y);
  }

  // ── Footer + CANCELLED watermark (every page) ───────────────────────
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    if (isCancelled) drawCancelledWatermark();
    doc.setDrawColor(BRAND_RULE);
    doc.line(PAGE_MARGIN, pageH - 16, pageW - PAGE_MARGIN, pageH - 16);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(BRAND_MUTED);
    doc.text(`${buyer.displayName} · Generated via BrainBase Commercial`, PAGE_MARGIN, pageH - 10);
    doc.text(`Page ${p} of ${pageCount}`, pageW - PAGE_MARGIN, pageH - 10, { align: 'right' });
  }

  return new Uint8Array(doc.output('arraybuffer') as ArrayBuffer);
}

// Re-exported so purchaseOrderEmail.ts and any future PO document
// caller do not need to know these constants actually live in
// quotePdf.ts — mirrors invoicePdf.ts's own identical re-export.
export { BRAND_INK, BRAND_PURPLE, BRAND_MUTED, BRAND_RULE, HEADER_BAND_FILL, HEADER_INK, HEADER_MUTED };
