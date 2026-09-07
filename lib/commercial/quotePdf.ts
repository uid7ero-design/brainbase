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
// Hybrid Orbit icon+wordmark lockup — is passed in as an already-loaded
// base64 PNG string by the caller, because LOADING that asset genuinely
// differs between environments (an API route reads the file from disk;
// the browser fetches it) — see loadBrandLockupBase64Server() in
// lib/commercial/quoteEmail.ts for the server-side loader, and
// app/commercial/quotes/[id]/page.tsx's own loader for the browser one.
//
// Phase C3-COMMERCIAL-BRAND-RENDERING — root cause of the "lambda
// characters/wordmark missing or malformed" defect the human production
// smoke test found: the C3-POLISH-R version of this file drew
// "BRΛINBΛSE" using jsPDF's standard "helvetica" font via doc.text(),
// including the literal Greek capital lambda character (U+039B) for
// both Λs. jsPDF's built-in standard-14 fonts (helvetica/times/courier)
// only support WinAnsiEncoding (essentially Windows-1252) — a Latin-1-ish
// character set with NO Greek code points at all. Confirmed empirically:
// doc.getTextWidth('Λ') returns a different, plausible-looking value
// (not zero, not an error), but the actual glyph painted into the PDF is
// whatever WinAnsiEncoding happens to map that byte to — not a real
// Greek lambda — which is exactly "missing or malformed" from a reader's
// perspective.
//
// The fix is to never ask jsPDF's standard fonts to draw that character
// at all. public/Brand/brainbase-horizontal-color.svg — the canonical
// Hybrid Orbit horizontal lockup used live by
// components/brand/BrainBaseWordmark.tsx — already contains the correct
// lambda/chevron treatment as hand-drawn VECTOR PATHS (not text), drawn
// by the original brand kit designer, not by any font's glyph table.
// Rasterizing that exact, unmodified SVG to PNG (see
// public/Brand/brainbase-horizontal-color-284.png, generated verbatim
// from the source SVG via sharp — never redrawn or approximated) and
// embedding it as an image sidesteps the font-encoding problem
// completely, and is MORE faithful to the brand than the previous
// icon+text-approximation, since it's the exact, complete, designer-made
// lockup rather than a font-rendered stand-in.
//
// That SVG's wordmark glyphs are filled near-white — "designed for dark
// surfaces only" per BrainBaseWordmark.tsx's own header comment — so
// this header is now rendered as a full-bleed dark band (a standard
// letterhead convention: colored header band, white body below) rather
// than placed directly on the page's white background, where a
// near-white lockup would be invisible.
export const BRAND_INK = '#11151F'; // matches the retired -light asset's own dark-ink convention
export const BRAND_PURPLE = '#7C5CFF'; // orbitGrad/wmAccent mid-stop, public/Brand/brainbase-horizontal-color.svg
export const BRAND_MUTED = '#6b7280';
export const BRAND_RULE = '#e2e2e8';
export const HEADER_BAND_FILL = '#0B0D12'; // near-black, matches the dark-surface convention brainbase-horizontal-color.svg is designed against
export const HEADER_INK = '#F4F6FB'; // exact fill color used by the wordmark glyphs themselves in brainbase-horizontal-color.svg
export const HEADER_MUTED = '#9CA3AF';
const HEADER_BAND_HEIGHT = 32;
// Source SVG viewBox is 900x160 (5.625:1) — the rasterized PNG
// (brainbase-horizontal-color-284.png) matches that aspect ratio exactly.
const LOCKUP_ASPECT = 900 / 160;

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
  // Phase C3-EMAIL-FIX — string when this object arrived via JSON (the
  // browser download path), Date when it came straight from
  // lib/commercial/quotes.ts's own DB read in the same process (the
  // server-side email path) — see lib/commercial/dates.ts's
  // formatCommercialDate() for why both are handled correctly.
  issue_date: string | Date | null;
  expiry_date: string | Date | null;
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
  // raw base64 (no "data:image/png;base64," prefix) PNG of the FULL
  // icon+wordmark lockup (brainbase-horizontal-color.svg rasterized) —
  // not the icon alone. See this file's header comment for why.
  brandLockupBase64: string;
}

const PAGE_MARGIN = 18;
const BOTTOM_SAFE = 30; // reserve space so a page break never clips a row mid-line

export async function buildQuotePdf({ quote, lines, supplier, brandLockupBase64 }: BuildQuotePdfInput): Promise<Uint8Array> {
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

  // ── Header — full-bleed dark band, matching the letterhead convention
  // most professional AU business documents use when their primary mark
  // is a light-on-dark lockup (see this file's header comment for the
  // full root-cause/fix rationale). ─────────────────────────────────────
  doc.setFillColor(HEADER_BAND_FILL);
  doc.rect(0, 0, pageW, HEADER_BAND_HEIGHT, 'F');

  const lockupW = 62;
  const lockupH = lockupW / LOCKUP_ASPECT;
  const lockupY = (HEADER_BAND_HEIGHT - lockupH) / 2;
  doc.addImage(`data:image/png;base64,${brandLockupBase64}`, 'PNG', PAGE_MARGIN, lockupY, lockupW, lockupH);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(HEADER_INK);
  doc.text('QUOTE', pageW - PAGE_MARGIN, HEADER_BAND_HEIGHT / 2 - 1, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(HEADER_MUTED);
  doc.text(quote.quote_number ?? 'DRAFT', pageW - PAGE_MARGIN, HEADER_BAND_HEIGHT / 2 + 6, { align: 'right' });

  y = HEADER_BAND_HEIGHT + 12;

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
    // Plain ASCII — never the Greek lambda character in doc.text() (see
    // this file's header comment on why jsPDF's standard fonts render
    // it incorrectly). The header band's rasterized lockup image is the
    // only place the styled wordmark appears in this document.
    doc.text(`${supplier.displayName} · Generated via BrainBase Commercial`, PAGE_MARGIN, pageH - 10);
    doc.text(`Page ${p} of ${pageCount}`, pageW - PAGE_MARGIN, pageH - 10, { align: 'right' });
  }

  return new Uint8Array(doc.output('arraybuffer') as ArrayBuffer);
}
