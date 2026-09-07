import { formatMoneyCents } from './money';
import { formatCommercialDate } from './dates';

// Phase C3-POLISH-R §1/§2 — the single, shared Quote PDF renderer, used
// by BOTH the browser "Download PDF" button (app/commercial/quotes/[id]/page.tsx)
// and the server-side email-attachment path (lib/commercial/quoteEmail.ts).
// A single shared builder — rather than one renderer per surface — is a
// deliberate correctness requirement, not just a reuse nicety: the C3-POLISH-R
// brief's §15 snapshot-regression check explicitly requires "PDF
// resend/download uses issued snapshot", and the only way to guarantee a
// downloaded PDF and an emailed PDF for the same quote are byte-identical
// in content is to generate both from the exact same function fed the
// exact same data.
//
// Deliberately isomorphic: no `fetch`, no `fs`, no `window`/`document`
// reference anywhere in this file. jsPDF itself (dynamically imported,
// matching the existing convention in app/commercial/quotes/[id]/page.tsx)
// runs identically in a browser and in a Next.js API route's Node
// runtime. The one asset this file needs — the rasterized BrainBase
// Hybrid Orbit mark — is passed in as an already-loaded base64 PNG
// string by the caller, because LOADING that asset genuinely differs
// between environments (an API route reads the file from disk; the
// browser fetches it) — see loadBrandMarkBase64Server() in
// lib/commercial/quoteEmail.ts for the server-side loader, and
// app/commercial/quotes/[id]/page.tsx's own loader for the browser one.
//
// Brand fidelity trade-off (documented per the brief's own "clearly
// report the trade-off" instruction): the canonical Hybrid Orbit
// horizontal lockup (public/Brand/brainbase-horizontal-color.svg, used
// by components/brand/BrainBaseWordmark.tsx) is explicitly "designed for
// dark surfaces only" per that component's own header comment — its
// wordmark glyphs are filled near-white and would be invisible on this
// PDF's white page. No light-background variant of that specific
// horizontal lockup exists anywhere in this repository. Rather than
// inventing one, this renderer pairs the REAL, unmodified icon asset
// (public/Brand/brainbase-mark-color.svg, rasterized verbatim to PNG —
// see scripts note below) with a text wordmark set in the exact
// brand-purple accent already used throughout the live product
// (components/brand/BrandLogo.jsx's own "Λ receives a subtle violet
// accent — the single identity signal" treatment) — the icon is the real
// asset; only the wordmark is text, matching an existing, precedented
// on-brand pattern rather than a newly invented logo.
export const BRAND_INK = '#11151F'; // matches the retired -light asset's own dark-ink convention
export const BRAND_PURPLE = '#7C5CFF'; // orbitGrad/wmAccent mid-stop, public/Brand/brainbase-horizontal-color.svg
export const BRAND_MUTED = '#6b7280';
export const BRAND_RULE = '#e2e2e8';

export interface QuotePdfLine {
  description_snapshot: string;
  sku_snapshot: string | null;
  unit_snapshot: string | null;
  quantity: number;
  unit_price_cents: number;
  tax_code_snapshot: string | null;
  tax_rate_snapshot: string;
  line_total_cents: number;
}

export interface QuotePdfQuote {
  quote_number: string | null;
  status: string;
  currency: string;
  issue_date: string | null;
  expiry_date: string | null;
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
}

export interface QuotePdfSupplier {
  displayName: string; // businessProfile.tradingName ?? organisation.name — resolved by the caller
  address: string | null;
  email: string | null;
  phone: string | null;
  abn: string | null;
}

export interface BuildQuotePdfInput {
  quote: QuotePdfQuote;
  lines: QuotePdfLine[];
  supplier: QuotePdfSupplier;
  brandMarkBase64: string; // raw base64 (no "data:image/png;base64," prefix), PNG
}

const PAGE_MARGIN = 18;
const BOTTOM_SAFE = 30; // reserve space so a page break never clips a row mid-line

export async function buildQuotePdf({ quote, lines, supplier, brandMarkBase64 }: BuildQuotePdfInput): Promise<Uint8Array> {
  const jspdfMod = await import('jspdf');
  const JsPDF = (jspdfMod as unknown as { jsPDF?: unknown }).jsPDF ?? (jspdfMod as unknown as { default: unknown }).default;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = new (JsPDF as any)({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = PAGE_MARGIN;

  function ensureRoom(next: number) {
    if (y + next > pageH - BOTTOM_SAFE) {
      doc.addPage();
      y = PAGE_MARGIN;
    }
  }

  // ── Header ──────────────────────────────────────────────────────────
  const markSize = 11;
  doc.addImage(`data:image/png;base64,${brandMarkBase64}`, 'PNG', PAGE_MARGIN, y - 2, markSize, markSize);
  const wmX = PAGE_MARGIN + markSize + 4;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.setTextColor(BRAND_INK);
  doc.text('BR', wmX, y + 6);
  const brWidth = doc.getTextWidth('BR');
  doc.setTextColor(BRAND_PURPLE);
  doc.text('Λ', wmX + brWidth, y + 6); // Λ
  const lambdaWidth = doc.getTextWidth('Λ');
  doc.setTextColor(BRAND_INK);
  doc.text('INB', wmX + brWidth + lambdaWidth, y + 6);
  const inbWidth = doc.getTextWidth('INB');
  doc.setTextColor(BRAND_PURPLE);
  doc.text('Λ', wmX + brWidth + lambdaWidth + inbWidth, y + 6);
  const lambda2Width = doc.getTextWidth('Λ');
  doc.setTextColor(BRAND_INK);
  doc.text('SE', wmX + brWidth + lambdaWidth + inbWidth + lambda2Width, y + 6);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(BRAND_INK);
  doc.text('QUOTE', pageW - PAGE_MARGIN, y + 4, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(BRAND_MUTED);
  doc.text(quote.quote_number ?? 'DRAFT', pageW - PAGE_MARGIN, y + 11, { align: 'right' });
  y += 20;

  doc.setDrawColor(BRAND_RULE); doc.setLineWidth(0.4);
  doc.line(PAGE_MARGIN, y, pageW - PAGE_MARGIN, y);
  y += 10;

  // ── Supplier / Customer two-column section ────────────────────────
  const colW = (pageW - PAGE_MARGIN * 2 - 12) / 2;
  const leftX = PAGE_MARGIN;
  const rightX = PAGE_MARGIN + colW + 12;
  const sectionTop = y;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(BRAND_MUTED);
  doc.text('FROM', leftX, y);
  doc.text('QUOTE FOR', rightX, y);
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
  const custName = quote.customer_name_snapshot ?? '—';
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(BRAND_INK);
  doc.text(custName, rightX, rightY); rightY += 5.5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(BRAND_MUTED);
  if (quote.billing_address_snapshot) { for (const l of doc.splitTextToSize(quote.billing_address_snapshot, colW)) { doc.text(l, rightX, rightY); rightY += 4.6; } }
  if (quote.email_snapshot) { doc.text(quote.email_snapshot, rightX, rightY); rightY += 4.6; }
  if (quote.phone_snapshot) { doc.text(quote.phone_snapshot, rightX, rightY); rightY += 4.6; }
  if (quote.tax_identifier_snapshot) { doc.text(`ABN ${quote.tax_identifier_snapshot}`, rightX, rightY); rightY += 4.6; }

  y = Math.max(leftY, rightY, sectionTop + 24) + 6;

  // ── Quote details strip ─────────────────────────────────────────────
  doc.setFillColor(247, 247, 250);
  doc.roundedRect(PAGE_MARGIN, y, pageW - PAGE_MARGIN * 2, 16, 2, 2, 'F');
  const stripY = y + 10;
  const stripColW = (pageW - PAGE_MARGIN * 2) / 4;
  const details: [string, string][] = [
    ['QUOTE NUMBER', quote.quote_number ?? 'DRAFT'],
    ['ISSUE DATE', formatCommercialDate(quote.issue_date)],
    ['EXPIRY DATE', formatCommercialDate(quote.expiry_date)],
    ['STATUS', quote.status],
  ];
  details.forEach(([label, value], i) => {
    const x = PAGE_MARGIN + 5 + i * stripColW;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(BRAND_MUTED);
    doc.text(label, x, y + 5.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(BRAND_INK);
    doc.text(value, x, stripY);
  });
  y += 24;

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

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(BRAND_INK);
  for (const line of lines) {
    const descLines: string[] = doc.splitTextToSize(line.description_snapshot, col.qty - col.desc - 6);
    const rowHeight = Math.max(descLines.length * 4.6, 6) + 3;
    ensureRoom(rowHeight);
    doc.text(descLines, col.desc, y);
    if (line.sku_snapshot) {
      doc.setFontSize(7.5); doc.setTextColor(BRAND_MUTED);
      doc.text(line.sku_snapshot, col.desc, y + descLines.length * 4.6 + 0.5);
      doc.setFontSize(9.5); doc.setTextColor(BRAND_INK);
    }
    doc.text(`${line.quantity}${line.unit_snapshot ? ` ${line.unit_snapshot}` : ''}`, col.qty, y, { align: 'right' });
    doc.text(formatMoneyCents(line.unit_price_cents, quote.currency), col.price, y, { align: 'right' });
    doc.text(line.tax_code_snapshot ? `${line.tax_rate_snapshot}%` : '—', col.tax, y, { align: 'right' });
    doc.text(formatMoneyCents(line.line_total_cents, quote.currency), col.total, y, { align: 'right' });
    y += rowHeight;
  }

  y += 3;
  doc.setDrawColor(BRAND_RULE);
  doc.line(pageW - PAGE_MARGIN - 80, y, pageW - PAGE_MARGIN, y);
  y += 8;

  // ── Totals ───────────────────────────────────────────────────────────
  ensureRoom(28);
  const totalLabelX = pageW - PAGE_MARGIN - 56;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(BRAND_MUTED);
  doc.text('Subtotal', totalLabelX, y);
  doc.text(formatMoneyCents(quote.subtotal_cents, quote.currency), col.total, y, { align: 'right' });
  y += 6;
  doc.text('GST / Tax', totalLabelX, y);
  doc.text(formatMoneyCents(quote.tax_cents, quote.currency), col.total, y, { align: 'right' });
  y += 8;
  doc.setDrawColor(BRAND_RULE);
  doc.line(totalLabelX, y - 4, pageW - PAGE_MARGIN, y - 4);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(BRAND_INK);
  doc.text('Total', totalLabelX, y);
  doc.text(formatMoneyCents(quote.total_cents, quote.currency), col.total, y, { align: 'right' });
  y += 16;

  // ── Notes / Terms ────────────────────────────────────────────────────
  if (quote.notes) {
    ensureRoom(16);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(BRAND_INK); doc.text('Notes', PAGE_MARGIN, y); y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(BRAND_MUTED);
    const notesLines: string[] = doc.splitTextToSize(quote.notes, pageW - PAGE_MARGIN * 2);
    ensureRoom(notesLines.length * 4.4);
    doc.text(notesLines, PAGE_MARGIN, y);
    y += notesLines.length * 4.4 + 8;
  }
  if (quote.terms) {
    ensureRoom(16);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(BRAND_INK); doc.text('Terms', PAGE_MARGIN, y); y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(BRAND_MUTED);
    const termsLines: string[] = doc.splitTextToSize(quote.terms, pageW - PAGE_MARGIN * 2);
    ensureRoom(termsLines.length * 4.4);
    doc.text(termsLines, PAGE_MARGIN, y);
    y += termsLines.length * 4.4;
  }

  // ── Footer (every page) ──────────────────────────────────────────────
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(BRAND_RULE);
    doc.line(PAGE_MARGIN, pageH - 16, pageW - PAGE_MARGIN, pageH - 16);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(BRAND_MUTED);
    doc.text(`${supplier.displayName} · Generated via BRΛINBΛSE Commercial`, PAGE_MARGIN, pageH - 10);
    doc.text(`Page ${p} of ${pageCount}`, pageW - PAGE_MARGIN, pageH - 10, { align: 'right' });
  }

  return new Uint8Array(doc.output('arraybuffer') as ArrayBuffer);
}
