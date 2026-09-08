// Phase C4.1 — central invoice status/transition authority. Every
// invoice status mutation anywhere in this codebase (lib/commercial/
// invoices.ts's issueInvoice/voidInvoice — there is no other write path
// to commercial_invoices.status) MUST go through assertInvoiceTransition()
// first, so the legal-transition rule lives in exactly one place rather
// than being re-derived at each call site. Mirrors
// lib/commercial/quoteLifecycle.ts's own shape exactly.
//
// Three statuses — deliberately fewer than commercial_quotes' five. No
// SENT (sending/emailing an invoice is a delivery event tracked entirely
// separately, exactly like quotes' own commercial_document_deliveries —
// it is not a document-status transition), no PAID (no payment-allocation
// subsystem exists yet — see the C4.0 architecture report's §J payment
// boundary), no persisted OVERDUE (derived at read time from
// `status = 'ISSUED' AND due_date < today`, never a stored column that
// would need a background job to keep in sync).
export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'VOID';

export const INVOICE_STATUSES: InvoiceStatus[] = ['DRAFT', 'ISSUED', 'VOID'];

// DRAFT is the only status an invoice can ever be edited in (customer,
// notes, terms, dates, and every line CRUD operation all gate on
// isInvoiceEditable()). ISSUED and VOID are both equally immutable — an
// issued invoice may only move to VOID, never be edited in place; a
// future correction is a separate credit-note document (not built in
// C4.1), never a mutation of the original.
const TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  DRAFT: ['ISSUED'],
  ISSUED: ['VOID'],
  VOID: [],
};

export function isInvoiceEditable(status: InvoiceStatus): boolean {
  return status === 'DRAFT';
}

export function isValidInvoiceTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

// Throws a plain Error (never silently no-ops) for any transition not in
// the table above — including the same-status "transition" a naive
// caller might otherwise treat as a harmless no-op (e.g. ISSUED -> ISSUED
// is not a legal transition; issuing an already-issued invoice a second
// time must be rejected explicitly, not silently accepted) — mirrors
// quoteLifecycle.ts's assertQuoteTransition() exactly.
export function assertInvoiceTransition(from: InvoiceStatus, to: InvoiceStatus): void {
  if (!isValidInvoiceTransition(from, to)) {
    throw new Error(`Cannot transition invoice from ${from} to ${to}`);
  }
}

export function assertInvoiceEditable(status: InvoiceStatus): void {
  if (!isInvoiceEditable(status)) {
    throw new Error(`Invoice is ${status} and can no longer be edited`);
  }
}
