import 'server-only';
import sql from '@/lib/db';
import { getInvoice } from './invoices';
import { isValidCents } from './money';
import { logPaymentRecorded, logPaymentReversed } from './auditLog';
import { PAYMENT_METHODS, type PaymentMethod } from './paymentMethods';

// Phase C5.2 — tenant-scoped data access + business logic for
// commercial_payments/commercial_payment_allocations. Same discipline as
// every other lib/commercial/*.ts module: organisationId is always an
// explicit caller-supplied parameter (never resolved internally), every
// query is scoped by it, and structural tenant isolation (the composite
// FKs in scripts/create-commercial-payments.sql) backs up every
// application-level check rather than being the only line of defence.
//
// This file never adds a column to commercial_invoices and never
// changes InvoiceStatus — payment state is always derived at read time
// (see getInvoicePaymentSummary()), exactly mirroring
// lib/commercial/invoices.ts's own existing `overdue` field.
//
// Phase C5.3B-fix — this is a server-only module (see `import
// 'server-only'` above): it imports lib/db, whose neon() client throws
// if evaluated in a browser bundle. PAYMENT_METHODS/PaymentMethod now
// live in ./paymentMethods (a dependency-free, client-safe module) and
// are re-exported here so this stays the single source of truth for
// every server call site — never redefine them here.

export { PAYMENT_METHODS, type PaymentMethod };

export function isValidPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value);
}

export interface CommercialPayment {
  id: string;
  organisation_id: string;
  amount_cents: number;
  currency: string;
  method: PaymentMethod;
  reference: string | null;
  provider: string | null;
  provider_reference: string | null;
  received_at: string;
  status: 'RECORDED' | 'REVERSED';
  recorded_by: string | null;
  reversed_at: string | null;
  reversed_by: string | null;
  reversal_reason: string | null;
  created_at: string;
  updated_at: string;
}

export type InvoicePaymentState = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';

export interface InvoicePaymentSummary {
  amount_paid_cents: number;
  outstanding_balance_cents: number;
  payment_state: InvoicePaymentState;
  payments: CommercialPayment[];
}

// ── Canonical "active (non-reversed) paid amount" aggregate ──────────
//
// This exact SUM formula appears in THREE places in this codebase:
//   1. Below, in getInvoicePaymentSummary() (a plain, non-locking read).
//   2. Inside recordInvoicePayment()'s single atomic statement (locked
//      by the same statement's own FOR UPDATE guard).
//   3. Inside lib/commercial/invoices.ts's voidInvoice() atomic
//      statement (locked the same way, for the paid-invoice void-block
//      rule).
// It cannot be shared as a single JS-level function, because (2) and
// (3) each embed it inside one single compound SQL statement (CTEs)
// for atomicity — the same reason issueInvoiceAtomically() (invoices.ts)
// cannot call out to a separate JS function mid-statement either. If
// this formula ever changes, all three call sites MUST be updated
// together — each site's own comment cross-references the other two.
function derivePaymentState(paidCents: number, totalCents: number): InvoicePaymentState {
  if (paidCents <= 0) return 'UNPAID';
  if (paidCents >= totalCents) return 'PAID';
  return 'PARTIALLY_PAID';
}

// Read-only, non-locking. Used by the invoice GET route to compose the
// payment summary alongside the invoice itself — same "additive read
// composition, not domain-logic duplication" pattern already used there
// for sourceQuoteNumber/deliveries.
export async function getInvoicePaymentSummary(
  organisationId: string,
  invoiceId: string,
  totalCents: number,
): Promise<InvoicePaymentSummary> {
  const paidRows = (await sql`
    SELECT COALESCE(SUM(cpa.allocated_amount_cents), 0)::int AS paid_cents
    FROM commercial_payment_allocations cpa
    JOIN commercial_payments cp ON cp.id = cpa.payment_id AND cp.organisation_id = cpa.organisation_id
    WHERE cpa.organisation_id = ${organisationId} AND cpa.invoice_id = ${invoiceId} AND cp.status = 'RECORDED'
  `) as { paid_cents: number }[];
  const amountPaidCents = paidRows[0]?.paid_cents ?? 0;

  const payments = (await sql`
    SELECT cp.* FROM commercial_payments cp
    JOIN commercial_payment_allocations cpa ON cpa.payment_id = cp.id AND cpa.organisation_id = cp.organisation_id
    WHERE cpa.organisation_id = ${organisationId} AND cpa.invoice_id = ${invoiceId}
    ORDER BY cp.received_at DESC, cp.created_at DESC
  `) as CommercialPayment[];

  return {
    amount_paid_cents: amountPaidCents,
    outstanding_balance_cents: Math.max(0, totalCents - amountPaidCents),
    payment_state: derivePaymentState(amountPaidCents, totalCents),
    payments,
  };
}

// Phase C5.2 §B — records exactly one payment against exactly one
// invoice, and its exactly-one allocation, atomically. Mirrors
// issueInvoiceAtomically()'s (lib/commercial/invoices.ts) own proven
// shape: a single compound SQL statement (a `guard` CTE taking a
// SELECT ... FOR UPDATE row lock on the invoice, gating an
// overpayment-checked INSERT into commercial_payments, gating an INSERT
// into commercial_payment_allocations) that Postgres executes as one
// atomic unit — never two separate transactions, never a
// check-then-insert sequence a concurrent request could race between.
//
// A losing concurrent caller's `guard` CTE either finds the invoice no
// longer ISSUED (blocks on the lock, then re-reads the now-current
// status) or finds the just-computed `active_paid` amount already
// reflects the winner's own committed payment — either way, the
// `ins_payment` CTE's own WHERE clause (amount <= remaining balance)
// evaluates false and inserts zero rows, and the entire statement
// therefore commits nothing at all. Not "insert then roll back" —
// genuinely never touches either table.
//
// Precondition checks (DRAFT/VOID/not-found/validation) run BEFORE the
// atomic statement via a plain, non-locking read — exactly like
// issueInvoice()'s own precondition checks run before calling
// issueInvoiceAtomically(). A request that fails one of these never
// reaches the atomic statement at all.
export async function recordInvoicePayment(params: {
  organisationId: string;
  userId: string;
  invoiceId: string;
  amountCents: number;
  method: PaymentMethod;
  reference?: string | null;
  provider?: string | null;
  providerReference?: string | null;
  receivedAt?: string | null;
}): Promise<{ payment: CommercialPayment; summary: InvoicePaymentSummary }> {
  if (!isValidCents(params.amountCents) || params.amountCents <= 0) {
    throw new Error('amount_cents must be a positive integer.');
  }
  if (!isValidPaymentMethod(params.method)) {
    throw new Error('Invalid payment method.');
  }
  // Same invariant as the DB-level CHECK constraint, enforced here too
  // so a caller gets a clear 400 rather than relying solely on the
  // constraint violation surfacing as a generic SQL error.
  if (params.providerReference && !params.provider) {
    throw new Error('provider is required when provider_reference is set.');
  }

  const invoice = await getInvoice(params.organisationId, params.invoiceId);
  if (!invoice) throw new Error('invoice not found for this organisation');
  if (invoice.status === 'DRAFT') throw new Error('cannot record a payment against a DRAFT invoice');
  if (invoice.status === 'VOID') throw new Error('cannot record a payment against a VOID invoice');

  const rows = (await sql`
    WITH guard AS (
      SELECT id, total_cents FROM commercial_invoices
      WHERE id = ${params.invoiceId} AND organisation_id = ${params.organisationId} AND status = 'ISSUED'
      FOR UPDATE
    ),
    active_paid AS (
      SELECT COALESCE(SUM(cpa.allocated_amount_cents), 0)::int AS paid_cents
      FROM commercial_payment_allocations cpa
      JOIN commercial_payments cp ON cp.id = cpa.payment_id AND cp.organisation_id = cpa.organisation_id
      WHERE cpa.organisation_id = ${params.organisationId} AND cpa.invoice_id = ${params.invoiceId} AND cp.status = 'RECORDED'
    ),
    ins_payment AS (
      INSERT INTO commercial_payments (organisation_id, amount_cents, currency, method, reference, provider, provider_reference, received_at, recorded_by)
      SELECT ${params.organisationId}, ${params.amountCents}, 'AUD', ${params.method}, ${params.reference ?? null},
             ${params.provider ?? null}, ${params.providerReference ?? null}, COALESCE(${params.receivedAt ?? null}::timestamptz, now()), ${params.userId}
      FROM guard, active_paid
      WHERE ${params.amountCents} <= (guard.total_cents - active_paid.paid_cents)
      RETURNING *
    ),
    ins_allocation AS (
      INSERT INTO commercial_payment_allocations (organisation_id, payment_id, invoice_id, allocated_amount_cents)
      SELECT ${params.organisationId}, ins_payment.id, ${params.invoiceId}, ${params.amountCents}
      FROM ins_payment
      RETURNING id
    )
    SELECT ins_payment.* FROM ins_payment, ins_allocation
  `) as CommercialPayment[];

  const payment = rows[0];
  if (!payment) {
    // The atomic statement inserted nothing — determine why, for a
    // clear error message only (this read is NOT the authorization
    // decision; that already happened, correctly, inside the atomic
    // statement above).
    const current = await getInvoice(params.organisationId, params.invoiceId);
    if (!current || current.status !== 'ISSUED') {
      throw new Error('invoice status changed concurrently; payment aborted');
    }
    const paidRows = (await sql`
      SELECT COALESCE(SUM(cpa.allocated_amount_cents), 0)::int AS paid_cents
      FROM commercial_payment_allocations cpa
      JOIN commercial_payments cp ON cp.id = cpa.payment_id AND cp.organisation_id = cpa.organisation_id
      WHERE cpa.organisation_id = ${params.organisationId} AND cpa.invoice_id = ${params.invoiceId} AND cp.status = 'RECORDED'
    `) as { paid_cents: number }[];
    const remaining = current.total_cents - (paidRows[0]?.paid_cents ?? 0);
    if (params.amountCents > remaining) {
      throw new Error(`payment amount exceeds remaining balance (remaining: ${remaining} cents)`);
    }
    throw new Error('payment could not be recorded; please retry');
  }

  await logPaymentRecorded({
    organisationId: params.organisationId, userId: params.userId, paymentId: payment.id, invoiceId: params.invoiceId,
    amountCents: payment.amount_cents, method: payment.method, reference: payment.reference,
    provider: payment.provider, providerReference: payment.provider_reference, receivedAt: payment.received_at,
  });

  const summary = await getInvoicePaymentSummary(params.organisationId, params.invoiceId, invoice.total_cents);
  return { payment, summary };
}

// Phase C5.2 §D — a payment is immutable once RECORDED; the only legal
// transition is RECORDED -> REVERSED (mirrors voidInvoice()'s own
// ISSUED -> VOID shape exactly: reversed_at/reversed_by/reversal_reason
// populated, amount_cents/currency/method/reference/provider/
// provider_reference/received_at never touched). A guarded single
// UPDATE (`WHERE status = 'RECORDED'`) is sufficient here — unlike
// recordInvoicePayment(), reversing one already-existing row needs no
// separate row lock: Postgres's own row-level locking for a single
// UPDATE statement already serializes two concurrent reversal attempts
// on the same payment, and the WHERE guard ensures only the first one
// actually flips the status — a repeated/racing reversal request
// affects zero rows and throws the same "not RECORDED" error, never a
// duplicate effect.
export async function reverseInvoicePayment(params: {
  organisationId: string;
  userId: string;
  invoiceId: string;
  paymentId: string;
  reason: string;
}): Promise<CommercialPayment> {
  const trimmedReason = params.reason.trim();
  if (!trimmedReason) throw new Error('reversal_reason is required');

  const belongs = (await sql`
    SELECT cp.id FROM commercial_payments cp
    JOIN commercial_payment_allocations cpa ON cpa.payment_id = cp.id AND cpa.organisation_id = cp.organisation_id
    WHERE cp.id = ${params.paymentId} AND cp.organisation_id = ${params.organisationId} AND cpa.invoice_id = ${params.invoiceId}
  `) as { id: string }[];
  if (belongs.length === 0) throw new Error('payment not found for this invoice and organisation');

  const rows = (await sql`
    UPDATE commercial_payments
    SET status = 'REVERSED', reversed_by = ${params.userId}, reversed_at = now(), reversal_reason = ${trimmedReason}, updated_at = now()
    WHERE id = ${params.paymentId} AND organisation_id = ${params.organisationId} AND status = 'RECORDED'
    RETURNING *
  `) as CommercialPayment[];
  const reversed = rows[0];
  if (!reversed) throw new Error('payment already reversed, or changed concurrently');

  await logPaymentReversed({
    organisationId: params.organisationId, userId: params.userId, paymentId: reversed.id, invoiceId: params.invoiceId,
    amountCents: reversed.amount_cents, reversalReason: trimmedReason, reversedAt: reversed.reversed_at!,
  });

  return reversed;
}
