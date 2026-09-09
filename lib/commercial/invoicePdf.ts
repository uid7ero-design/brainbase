import { BRAND_INK, BRAND_PURPLE, BRAND_MUTED, BRAND_RULE, HEADER_BAND_FILL, HEADER_INK, HEADER_MUTED } from './quotePdf';
import { formatMoneyCents } from './money';
import { formatCommercialDate } from './dates';

// Phase C4.3B — invoice PDF renderer. A close structural adaptation of
// lib/commercial/quotePdf.ts's buildQuotePdf(), NOT a shared/parameterized
// function — this codebase's own established convention keeps
// per-document-type domain modules parallel rather than unified (see
// lib/commercial/quotes.ts vs invoices.ts, quoteLifecycle.ts vs
// invoiceLifecycle.ts). Only the truly shared, non-domain-specific
// pieces are reused directly: the brand color constants (imported from
// quotePdf.ts, not redefined) and the money/date formatters. quotePdf.ts
// itself is not modified by this file at all.
//
// Same isomorphic-by-design discipline as quotePdf.ts: no `fetch`, no
// `fs`, no `window`/`document` reference — jsPDF (dynamically imported)
// runs identically in a browser (the invoice detail page's Download PDF
// button) and in a Next.js API route's Node runtime (the email
// attachment path in lib/commercial/invoiceEmail.ts). The brand lockup
// asset is passed in as an already-loaded base64 PNG, for the same
// reason quotePdf.ts documents: loading it genuinely differs between a
// browser fetch and a server fs read.
//
// VOID TREATMENT — the one structural addition this file has that
// quotePdf.ts does not, since quotes have no VOID status. A VOID
// invoice must never look like an ordinary payable document: a large,
// unmistakable diagonal "VOID" watermark is drawn across the page
// (every page, if the document overflows), and the stored void_reason
// is rendered in a dedicated, clearly-labelled callout near the top of
// the document body — never silently reprinted as if nothing changed.
const VOID_RED = '#DC2626';

export interface InvoicePdfLine {
  description_snapshot: string;
  sku_snapshot: string | null;
  unit_snapshot: string | null;
  quantity: number;
  unit_price_cents: number;
  tax_code_snapshot: string | null;
  tax_rate_snapshot: string;
  line_total_cents: number;
}

export interface InvoicePdfInvoice {
  invoice_number: string | null;
  status: string; // 'DRAFT' | 'ISSUED' | 'VOID' — callers must never invoke this builder for DRAFT (see the invoice detail page / send-email route's own gates)
  currency: string;
  // string when this object arrived via JSON (the browser download
  // path), Date when it came straight from lib/commercial/invoices.ts's
  // own DB read in the same process (the server-side email path) — see
  // lib/commercial/dates.ts's formatCommercialDate() for why both are
  // handled correctly.
  issue_date: string | Date | null;
  due_date: string | Date | null;
  notes: string | null;
  terms: string | null;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  customer_name_snapshot: string | null;
  billing_address_snapshot: string | null;
  email_snapshot: string | null;
  phone_snapshot: string | null;
  tax_identifier_snapshot: string | null;
  void_reason: string | null;
  // The source quote's own display number (e.g. "Q-000042"), already
  // resolved by the caller (the invoice detail API route already does
  // this via getQuote()) — never re-derived here. Omitted from the PDF
  // entirely when null (no source quote, or the quote lookup itself
  // failed/was inaccessible).
  source_quote_number: string | null;
}

export interface InvoicePdfSupplier {
  displayName: string; // businessProfile.tradingName ?? organisation.name — resolved by the caller
  address: string | null;
  email: string | null;
  phone: string | null;
  abn: string | null;
}

export interface BuildInvoicePdfInput {
  invoice: InvoicePdfInvoice;
  lines: InvoicePdfLine[];
  supplier: InvoicePdfSupplier;
  // raw base64 (no "data:image/png;base64," prefix) PNG of the FULL
  // icon+wordmark lockup — see quotePdf.ts's own header for why.
  brandLockupBase64: string;
}

const PAGE_MARGIN = 18;
const BOTTOM_SAFE = 30; // reserve space so a page break never clips a row mid-line
const LOCKUP_ASPECT = 900 / 160; // matches quotePdf.ts's own source SVG viewBox ratio

export async function buildInvoicePdf({ invoice, lines, supplier, brandLockupBase64 }: BuildInvoicePdfInput): Promise<Uint8Array> {
  const jspdfMod = await import('jspdf');
  const JsPDF = (jspdfMod as unknown as { jsPDF?: unknown }).jsPDF ?? (jspdfMod as unknown as { default: unknown }).default;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = new (JsPDF as any)({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = PAGE_MARGIN;
  const isVoid = invoice.status === 'VOID';

  function ensureRoom(next: number) {
    if (y + next > pageH - BOTTOM_SAFE) {
      doc.addPage();
      y = PAGE_MARGIN;
    }
  }

  function drawVoidWatermark() {
    doc.saveGraphicsState();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doc as any).setGState(new (doc as any).GState({ opacity: 0.16 }));
    doc.setTextColor(VOID_RED);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(92);
    doc.text('VOID', pageW / 2, pageH / 2, { align: 'center', angle: 35 });
    doc.restoreGraphicsState();
  }

  // ── Header — full-bleed dark band, matching quotePdf.ts's own
  // letterhead convention exactly. ────────────────────────────────────
  doc.setFillColor(HEADER_BAND_FILL);
  doc.rect(0, 0, pageW, 32, 'F');

  const lockupW = 62;
  const lockupH = lockupW / LOCKUP_ASPECT;
  const lockupY = (32 - lockupH) / 2;
  doc.addImage(`data:image/png;base64,${brandLockupBase64}`, 'PNG', PAGE_MARGIN, lockupY, lockupW, lockupH);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(HEADER_INK);
  doc.text('INVOICE', pageW - PAGE_MARGIN, 15, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(HEADER_MUTED);
  doc.text(invoice.invoice_number ?? 'DRAFT', pageW - PAGE_MARGIN, 22, { align: 'right' });

  y = 32 + 12;

  doc.setDrawColor(BRAND_RULE); doc.setLineWidth(0.4);
  doc.line(PAGE_MARGIN, y, pageW - PAGE_MARGIN, y);
  y += 10;

  // ── VOID callout — a dedicated, clearly-labelled block near the top
  // of the document body, never silently omitted or buried. Drawn
  // BEFORE the supplier/customer section so it is the first thing a
  // reader's eye lands on after the header. ──────────────────────────
  if (isVoid) {
    ensureRoom(20);
    doc.setFillColor(254, 226, 226); // light red background, matches VOID_RED
    doc.setDrawColor(VOID_RED);
    doc.setLineWidth(0.6);
    doc.roundedRect(PAGE_MARGIN, y, pageW - PAGE_MARGIN * 2, invoice.void_reason ? 20 : 12, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(VOID_RED);
    doc.text('THIS INVOICE HAS BEEN VOIDED — DO NOT PAY', PAGE_MARGIN + 5, y + 7.5);
    if (invoice.void_reason) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(BRAND_INK);
      const reasonLines: string[] = doc.splitTextToSize(`Reason: ${invoice.void_reason}`, pageW - PAGE_MARGIN * 2 - 10);
      doc.text(reasonLines[0], PAGE_MARGIN + 5, y + 14.5);
    }
    y += (invoice.void_reason ? 20 : 12) + 8;
  }

  // ── Supplier / Customer two-column section ────────────────────────
  const colW = (pageW - PAGE_MARGIN * 2 - 12) / 2;
  const leftX = PAGE_MARGIN;
  const rightX = PAGE_MARGIN + colW + 12;
  const sectionTop = y;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(BRAND_MUTED);
  doc.text('FROM', leftX, y);
  doc.text('BILL TO', rightX, y);
  y += 5.5;

  let leftY = y;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(BRAND_INK);
  doc.text(supplier.displayName, leftX, leftY); leftY += 5.5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(BRAND_MUTED);
  if (supplier.address) { for (const l of doc.splitTextToSize(supplier.address, colW)) { doc.text(l, leftX, leftY); leftY += 4.6; } }
  if (supplier.email) { doc.text(supplier.email, leftX, leftY); leftY += 4.6; }
  if (supplier.phone) { doc.text(supplier.phone, leftX, leftY); leftY += 4.6; }
  if (supplier.abn) { doc.text(`ABN ${supplier.abn}`, leftX, leftY); leftY += 4.6; }

  let rightY = y;
  const custName = invoice.customer_name_snapshot ?? '—';
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(BRAND_INK);
  doc.text(custName, rightX, rightY); rightY += 5.5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(BRAND_MUTED);
  if (invoice.billing_address_snapshot) { for (const l of doc.splitTextToSize(invoice.billing_address_snapshot, colW)) { doc.text(l, rightX, rightY); rightY += 4.6; } }
  if (invoice.email_snapshot) { doc.text(invoice.email_snapshot, rightX, rightY); rightY += 4.6; }
  if (invoice.phone_snapshot) { doc.text(invoice.phone_snapshot, rightX, rightY); rightY += 4.6; }
  if (invoice.tax_identifier_snapshot) { doc.text(`ABN ${invoice.tax_identifier_snapshot}`, rightX, rightY); rightY += 4.6; }

  y = Math.max(leftY, rightY, sectionTop + 24) + 6;

  // ── Invoice details strip ────────────────────────────────────────
  doc.setFillColor(247, 247, 250);
  doc.roundedRect(PAGE_MARGIN, y, pageW - PAGE_MARGIN * 2, 16, 2, 2, 'F');
  const stripY = y + 10;
  const stripColW = (pageW - PAGE_MARGIN * 2) / 4;
  const details: [string, string][] = [
    ['INVOICE NUMBER', invoice.invoice_number ?? 'DRAFT'],
    ['ISSUE DATE', formatCommercialDate(invoice.issue_date)],
    ['DUE DATE', formatCommercialDate(invoice.due_date)],
    ['STATUS', invoice.status],
  ];
  details.forEach(([label, value], i) => {
    const x = PAGE_MARGIN + 5 + i * stripColW;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(BRAND_MUTED);
    doc.text(label, x, y + 5.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(isVoid && label === 'STATUS' ? VOID_RED : BRAND_INK);
    doc.text(value, x, stripY);
  });
  y += 24;

  // ── Source quote reference — only when present ─────────────────────
  if (invoice.source_quote_number) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(BRAND_MUTED);
    doc.text(`Source Quote: ${invoice.source_quote_number}`, PAGE_MARGIN, y);
    y += 8;
  }

  // ── Line items ───────────────────────────────────────────────────────
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

  // Same rowHeight/SKU-clearance formula quotePdf.ts already uses,
  // proven correct there — see that file's own header comment for the
  // full derivation. Reproduced here rather than imported since it is
  // entangled with this function's own local `y`/`col`/`doc` state, not
  // a standalone pure helper.
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
    doc.text(formatMoneyCents(line.unit_price_cents, invoice.currency), col.price, y, { align: 'right' });
    doc.text(line.tax_code_snapshot ? `${line.tax_rate_snapshot}%` : '—', col.tax, y, { align: 'right' });
    doc.text(formatMoneyCents(line.line_total_cents, invoice.currency), col.total, y, { align: 'right' });
    y += rowHeight;
  }

  y += 3;
  doc.setDrawColor(BRAND_RULE);
  doc.line(pageW - PAGE_MARGIN - 80, y, pageW - PAGE_MARGIN, y);
  y += 8;

  // ── Totals — formats already-persisted, server-computed cents values
  // ONLY. Never derives/recomputes subtotal, tax, or total from unit
  // prices or quantities here — that arithmetic belongs exclusively to
  // lib/commercial/invoices.ts's recalculateInvoiceTotals(), which
  // already runs server-side on every line mutation. ─────────────────
  ensureRoom(28);
  const totalLabelX = pageW - PAGE_MARGIN - 56;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(BRAND_MUTED);
  doc.text('Subtotal', totalLabelX, y);
  doc.text(formatMoneyCents(invoice.subtotal_cents, invoice.currency), col.total, y, { align: 'right' });
  y += 6;
  doc.text('GST / Tax', totalLabelX, y);
  doc.text(formatMoneyCents(invoice.tax_cents, invoice.currency), col.total, y, { align: 'right' });
  y += 8;
  doc.setDrawColor(BRAND_RULE);
  doc.line(totalLabelX, y - 4, pageW - PAGE_MARGIN, y - 4);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(isVoid ? VOID_RED : BRAND_INK);
  doc.text(isVoid ? 'Total (Voided)' : 'Total', totalLabelX, y);
  doc.text(formatMoneyCents(invoice.total_cents, invoice.currency), col.total, y, { align: 'right' });
  y += 16;

  // ── Notes / Terms ────────────────────────────────────────────────────
  if (invoice.notes) {
    ensureRoom(16);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(BRAND_INK); doc.text('Notes', PAGE_MARGIN, y); y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(BRAND_MUTED);
    const notesLines: string[] = doc.splitTextToSize(invoice.notes, pageW - PAGE_MARGIN * 2);
    ensureRoom(notesLines.length * 4.4);
    doc.text(notesLines, PAGE_MARGIN, y);
    y += notesLines.length * 4.4 + 8;
  }
  if (invoice.terms) {
    ensureRoom(16);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(BRAND_INK); doc.text('Terms', PAGE_MARGIN, y); y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(BRAND_MUTED);
    const termsLines: string[] = doc.splitTextToSize(invoice.terms, pageW - PAGE_MARGIN * 2);
    ensureRoom(termsLines.length * 4.4);
    doc.text(termsLines, PAGE_MARGIN, y);
    y += termsLines.length * 4.4;
  }

  // ── Footer + VOID watermark (every page) ────────────────────────────
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    if (isVoid) drawVoidWatermark();
    doc.setDrawColor(BRAND_RULE);
    doc.line(PAGE_MARGIN, pageH - 16, pageW - PAGE_MARGIN, pageH - 16);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(BRAND_MUTED);
    // Plain ASCII — never the Greek lambda character in doc.text() (see
    // quotePdf.ts's own header comment on why jsPDF's standard fonts
    // render it incorrectly). The header band's rasterized lockup image
    // is the only place the styled wordmark appears in this document.
    doc.text(`${supplier.displayName} · Generated via BrainBase Commercial`, PAGE_MARGIN, pageH - 10);
    doc.text(`Page ${p} of ${pageCount}`, pageW - PAGE_MARGIN, pageH - 10, { align: 'right' });
  }

  return new Uint8Array(doc.output('arraybuffer') as ArrayBuffer);
}

// Re-exported for callers (invoiceEmail.ts, the invoice detail page)
// that only need the color constants without importing quotePdf.ts
// directly — avoids every invoice-side caller having to know these
// constants actually live in the quote module.
export { BRAND_INK, BRAND_PURPLE, BRAND_MUTED, BRAND_RULE, HEADER_BAND_FILL, HEADER_INK, HEADER_MUTED };
