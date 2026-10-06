import 'server-only';
import { jsPDF } from 'jspdf';
import { BRAND_INK, BRAND_MUTED, BRAND_RULE, HEADER_BAND_FILL, HEADER_INK } from './quotePdf';
import { formatMoneyCentsExact } from './money';
import { formatCommercialDate } from './dates';
import type { SupplierRemittanceDocument } from './supplierRemittanceDocument';

export function buildSupplierRemittancePdf(document: SupplierRemittanceDocument): Uint8Array {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const margin = 18;
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  let y = 46;
  const reversed = document.status === 'REVERSED';
  function header() {
    doc.setFillColor(HEADER_BAND_FILL); doc.rect(0, 0, width, 34, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(HEADER_INK);
    doc.text('SUPPLIER REMITTANCE', margin, 15);
    doc.setFontSize(10); doc.text(reversed ? 'REVERSED - NO ACTIVE SETTLEMENT' : 'RECORDED PAYMENT', margin, 25);
    doc.setTextColor(BRAND_INK); doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  }
  function room() {
    if (y > height - 27) { doc.addPage(); header(); y = 46; }
  }
  function text(value: string, bold = false) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    const lines = doc.splitTextToSize(value, width - margin * 2) as string[];
    for (const line of lines) { room(); doc.text(line, margin, y); y += 5; }
    y += 3;
  }
  header();
  text(`Purchaser: ${document.organisation_name}`, true);
  text(`Supplier: ${document.supplier_name}`, true);
  text(`Payment ID: ${document.payment_id}`);
  text(`Paid date: ${formatCommercialDate(document.paid_at)}`);
  text(`Method: ${document.method.replaceAll('_', ' ')}`);
  text(`Reference: ${document.reference ?? 'Not supplied'}`);
  text(`Currency: ${document.currency}`);
  if (reversed) {
    doc.setTextColor('#DC2626');
    text(`Reversed: ${document.reversed_at ? formatCommercialDate(document.reversed_at) : 'Date unavailable'}`, true);
    text(`Reason: ${document.reversal_reason ?? 'Not supplied'}`);
    doc.setTextColor(BRAND_INK);
  }
  text('BILL ALLOCATIONS', true);
  for (const allocation of document.allocations) {
    room();
    doc.setDrawColor(BRAND_RULE); doc.line(margin, y - 3, width - margin, y - 3);
    doc.setFont('helvetica', 'bold');
    const label = `${allocation.bill_number ?? 'Bill'} / Invoice ${allocation.supplier_invoice_number}`;
    const lines = doc.splitTextToSize(label, 115) as string[];
    doc.text(formatMoneyCentsExact(allocation.allocated_amount_cents, document.currency), width - margin, y, { align: 'right' });
    for (const line of lines) { room(); doc.text(line, margin, y); y += 5; }
    y += 5;
  }
  text(`${reversed ? 'Original payment total (reversed)' : 'Payment total'}: ${formatMoneyCentsExact(document.amount_cents, document.currency)}`, true);
  doc.setTextColor(BRAND_MUTED);
  text('This document reflects the payment recorded in BrainBase. It is not bank confirmation. Supplier and purchaser names reflect current records.');
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setTextColor(BRAND_MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text('BrainBase Commercial', margin, height - 12);
    doc.text(`Page ${page} of ${pages}`, width - margin, height - 12, { align: 'right' });
  }
  return new Uint8Array(doc.output('arraybuffer'));
}
