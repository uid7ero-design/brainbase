import sql from '@/lib/db';
import { getCustomer } from './customers';
import { getProduct } from './products';
import { getTaxCode } from './taxCodes';
import { getQuoteWithLines } from './quotes';
import { sumCents, lineTotalCents, applyRatePercentCents, isValidCents } from './money';
import { assertInvoiceTransition, assertInvoiceEditable, type InvoiceStatus } from './invoiceLifecycle';
import {
  logInvoiceCreated, logInvoiceCreatedFromQuote, logInvoiceUpdated, logInvoiceIssued,
  logInvoiceVoided, logInvoiceDeleted,
} from './auditLog';

// Phase C4.1 — tenant-scoped data access + business logic for
// commercial_invoices/commercial_invoice_lines. Same discipline as every
// other lib/commercial/*.ts module (see lib/commercial/quotes.ts, which
// this file mirrors closely): organisationId is always an explicit
// caller-supplied parameter (never resolved internally), every query is
// scoped by it, and structural tenant isolation (the composite FKs in
// scripts/create-commercial-invoices.sql) backs up every
// application-level check rather than being the only line of defence.
//
// Deliberately duplicates, rather than imports, quotes.ts's private
// computeLineTotals()-shaped composition of the genuinely shared
// lib/commercial/money.ts primitives — a ~5-line function, not worth a
// cross-module dependency for. quoteLifecycle.ts / invoiceLifecycle.ts
// are two separate, independently-evolving state machines by design
// (see invoiceLifecycle.ts's own header for why invoices need fewer
// statuses than quotes) — this file never imports from quoteLifecycle.ts.

export interface CommercialInvoice {
  id: string;
  organisation_id: string;
  customer_id: string;
  source_quote_id: string | null;
  invoice_number: string | null;
  status: InvoiceStatus;
  currency: string;
  issue_date: string | null;
  due_date: string | null;
  payment_terms_days: number | null;
  notes: string | null;
  terms: string | null;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  customer_name_snapshot: string | null;
  billing_name_snapshot: string | null;
  billing_address_snapshot: string | null;
  email_snapshot: string | null;
  phone_snapshot: string | null;
  tax_identifier_snapshot: string | null;
  created_by: string | null;
  issued_by: string | null;
  voided_by: string | null;
  void_reason: string | null;
  created_at: string;
  updated_at: string;
  issued_at: string | null;
  voided_at: string | null;
}

// Phase C4.2 blocker fix — `overdue` is a SQL-computed, read-only
// projection, deliberately NOT a column on CommercialInvoice itself: it
// is never written by any mutation (create/update/issue/void all use
// `RETURNING *`, which cannot include a derived expression), only ever
// produced by the two read queries below. Kept as a separate type
// (rather than adding `overdue` directly to CommercialInvoice, which
// every write-path function also returns) so no mutation function's
// return shape has to lie about carrying a field it never actually sets.
//
// Computed with Postgres's own CURRENT_DATE — never in JavaScript.
// lib/commercial/dates.ts's own header comment already documents,
// empirically, that this driver parses a DATE column into a native JS
// Date object when read in-process — comparing that against a
// 'YYYY-MM-DD' string with `<` silently coerces to NaN and is always
// false (confirmed: `new Date(2000,0,1) < '2026-09-08'` is `false`).
// Doing the comparison in SQL instead sidesteps that whole class of bug:
// due_date and CURRENT_DATE are both native Postgres DATE values there,
// compared with real date semantics, and the result is a genuine SQL
// boolean (never null — the extra `due_date IS NOT NULL` guard exists
// only for defensive belt-and-suspenders correctness, since issueInvoice()
// already refuses to issue an invoice with no due_date, so an ISSUED row
// should never actually have a null one).
export interface CommercialInvoiceWithOverdue extends CommercialInvoice {
  overdue: boolean;
}

export interface CommercialInvoiceLine {
  id: string;
  organisation_id: string;
  invoice_id: string;
  product_id: string | null;
  source_quote_line_id: string | null;
  position: number;
  description_snapshot: string;
  sku_snapshot: string | null;
  unit_snapshot: string | null;
  quantity: number;
  unit_price_cents: number;
  tax_code_snapshot: string | null;
  tax_rate_snapshot: string; // NUMERIC(5,2) — string from the driver, never coerced to float
  line_subtotal_cents: number;
  line_tax_cents: number;
  line_total_cents: number;
  created_at: string;
  updated_at: string;
}

// `(status = 'ISSUED' AND due_date IS NOT NULL AND due_date < CURRENT_DATE) AS overdue`
// is embedded directly (fully static SQL text, no interpolated value) in
// both read queries below — see CommercialInvoiceWithOverdue's own header
// comment for why this must be computed in SQL, never in JS.
export async function listInvoices(organisationId: string, opts: { status?: InvoiceStatus } = {}): Promise<CommercialInvoiceWithOverdue[]> {
  if (opts.status) {
    return (await sql`
      SELECT *, (status = 'ISSUED' AND due_date IS NOT NULL AND due_date < CURRENT_DATE) AS overdue
      FROM commercial_invoices WHERE organisation_id = ${organisationId} AND status = ${opts.status}
      ORDER BY created_at DESC
    `) as CommercialInvoiceWithOverdue[];
  }
  return (await sql`
    SELECT *, (status = 'ISSUED' AND due_date IS NOT NULL AND due_date < CURRENT_DATE) AS overdue
    FROM commercial_invoices WHERE organisation_id = ${organisationId} ORDER BY created_at DESC
  `) as CommercialInvoiceWithOverdue[];
}

// Returns null both for "does not exist" and "exists but belongs to a
// different organisation" — same indistinguishable-by-design rule as
// every other getX() in this Commercial module (mirrors getQuote()).
export async function getInvoice(organisationId: string, invoiceId: string): Promise<CommercialInvoiceWithOverdue | null> {
  const rows = (await sql`
    SELECT *, (status = 'ISSUED' AND due_date IS NOT NULL AND due_date < CURRENT_DATE) AS overdue
    FROM commercial_invoices WHERE id = ${invoiceId} AND organisation_id = ${organisationId}
  `) as CommercialInvoiceWithOverdue[];
  return rows[0] ?? null;
}

export async function listInvoiceLines(organisationId: string, invoiceId: string): Promise<CommercialInvoiceLine[]> {
  return (await sql`
    SELECT * FROM commercial_invoice_lines
    WHERE invoice_id = ${invoiceId} AND organisation_id = ${organisationId}
    ORDER BY position ASC, created_at ASC
  `) as CommercialInvoiceLine[];
}

export async function getInvoiceWithLines(organisationId: string, invoiceId: string): Promise<{ invoice: CommercialInvoiceWithOverdue; lines: CommercialInvoiceLine[] } | null> {
  const invoice = await getInvoice(organisationId, invoiceId);
  if (!invoice) return null;
  const lines = await listInvoiceLines(organisationId, invoiceId);
  return { invoice, lines };
}

// Recomputes and persists subtotal_cents/tax_cents/total_cents from the
// CURRENT set of line rows — the single source of truth for invoice-level
// totals, mirroring quotes.ts's recalculateQuoteTotals() exactly. Called
// after every line mutation and once more, defensively, at issue time.
async function recalculateInvoiceTotals(organisationId: string, invoiceId: string): Promise<void> {
  const lines = await listInvoiceLines(organisationId, invoiceId);
  const subtotal = sumCents(lines.map(l => l.line_subtotal_cents));
  const tax = sumCents(lines.map(l => l.line_tax_cents));
  const total = sumCents(lines.map(l => l.line_total_cents));
  await sql`
    UPDATE commercial_invoices SET subtotal_cents = ${subtotal}, tax_cents = ${tax}, total_cents = ${total}, updated_at = now()
    WHERE id = ${invoiceId} AND organisation_id = ${organisationId}
  `;
}

function computeLineTotals(unitPriceCents: number, quantity: number, taxRatePercent: number) {
  const line_subtotal_cents = lineTotalCents(unitPriceCents, quantity);
  const line_tax_cents = applyRatePercentCents(line_subtotal_cents, taxRatePercent);
  const line_total_cents = line_subtotal_cents + line_tax_cents;
  return { line_subtotal_cents, line_tax_cents, line_total_cents };
}

// ── Standalone draft creation ─────────────────────────────────────────

export async function createDraftInvoice(params: {
  organisationId: string;
  userId: string;
  customerId: string;
  currency?: string;
  notes?: string | null;
  terms?: string | null;
  dueDate?: string | null;
  paymentTermsDays?: number | null;
}): Promise<CommercialInvoice> {
  // Friendly, non-enumerable pre-check before the INSERT — the composite
  // FK (commercial_invoices_customer_org_fkey) is the actual structural
  // guarantee; this check exists only so a cross-tenant/nonexistent
  // customer_id fails with a clear application error, mirroring
  // createDraftQuote()'s identical precheck.
  const customer = await getCustomer(params.organisationId, params.customerId);
  if (!customer) throw new Error('customer_id not found for this organisation');

  const rows = (await sql`
    INSERT INTO commercial_invoices (
      organisation_id, customer_id, currency, notes, terms, due_date, payment_terms_days, created_by
    ) VALUES (
      ${params.organisationId}, ${params.customerId}, ${params.currency ?? 'AUD'},
      ${params.notes ?? null}, ${params.terms ?? null}, ${params.dueDate ?? null}, ${params.paymentTermsDays ?? null}, ${params.userId}
    )
    RETURNING *
  `) as CommercialInvoice[];
  const invoice = rows[0];

  await logInvoiceCreated({
    organisationId: params.organisationId, userId: params.userId, invoiceId: invoice.id,
    after: { customer_id: invoice.customer_id, currency: invoice.currency },
  });

  return invoice;
}

// ── Quote -> Invoice conversion ──────────────────────────────────────
//
// Phase C4.1 §7 — the source quote must be ACCEPTED (a quote in any other
// status represents nothing a customer has actually agreed to yet).
// Rejects DRAFT/SENT/REJECTED/EXPIRED explicitly rather than silently
// converting. Missing/wrong-tenant quotes are rejected the same
// indistinguishable way getQuote() already does (getQuoteWithLines
// returns null for both).
//
// Every DB write (the invoice INSERT and every line INSERT) is built as
// one flat array of pre-computed queries and executed via sql.transaction()
// — the same non-interactive Neon primitive lib/commercial/
// documentNumbering.ts already uses — so a mismatch caught during the
// JS-side validation below (before any query is built) means NOTHING is
// ever written; there is no partial invoice with zero lines, and no
// invoice with mismatched totals can ever be persisted.
//
// Deliberately does NOT allocate an invoice number (numbers are only
// allocated at DRAFT -> ISSUED, never at creation — see
// invoiceLifecycle.ts's own header) and deliberately does NOT enforce any
// uniqueness on source_quote_id — one accepted quote may produce zero,
// one, or many invoices over time (future progress/deposit invoicing);
// nothing in this function prevents calling it again for the same quote.
export async function createInvoiceFromQuote(params: {
  organisationId: string;
  userId: string;
  quoteId: string;
}): Promise<CommercialInvoice> {
  const bundle = await getQuoteWithLines(params.organisationId, params.quoteId);
  if (!bundle) throw new Error('quote not found for this organisation');
  const { quote, lines: quoteLines } = bundle;

  if (quote.status !== 'ACCEPTED') {
    throw new Error(`Cannot create an invoice from a quote with status ${quote.status}; the quote must be ACCEPTED`);
  }
  if (quoteLines.length === 0) throw new Error('cannot create an invoice from a quote with no lines');

  // Defensive re-check: the quote's own customer_id is already
  // tenant-verified by commercial_quotes' own composite FK, but this
  // mirrors createDraftQuote()/createDraftInvoice()'s own
  // non-enumerable precheck for a clear application error instead of a
  // raw Postgres FK violation.
  const customer = await getCustomer(params.organisationId, quote.customer_id);
  if (!customer) throw new Error('customer not found for this organisation');

  // Recompute every line's totals from the COPIED snapshot values
  // (never a live join) and verify the sum agrees exactly with the
  // source quote's own already-persisted totals — a self-consistency
  // check on the copy step itself, not an expected-to-ever-fail
  // assertion in ordinary operation, but required so a future bug in
  // this copy logic fails loudly instead of silently persisting a
  // mismatched invoice.
  const computedLines = quoteLines.map(line => {
    const totals = computeLineTotals(line.unit_price_cents, line.quantity, Number(line.tax_rate_snapshot));
    return { line, totals };
  });
  const recomputedSubtotal = sumCents(computedLines.map(c => c.totals.line_subtotal_cents));
  const recomputedTax = sumCents(computedLines.map(c => c.totals.line_tax_cents));
  const recomputedTotal = sumCents(computedLines.map(c => c.totals.line_total_cents));
  if (
    recomputedSubtotal !== quote.subtotal_cents ||
    recomputedTax !== quote.tax_cents ||
    recomputedTotal !== quote.total_cents
  ) {
    throw new Error('recomputed line totals do not match the source quote\'s own totals; aborting invoice creation without writing anything');
  }

  const invoiceId = crypto.randomUUID();
  const queries = [
    sql`
      INSERT INTO commercial_invoices (
        id, organisation_id, customer_id, source_quote_id, currency, subtotal_cents, tax_cents, total_cents, created_by
      ) VALUES (
        ${invoiceId}, ${params.organisationId}, ${quote.customer_id}, ${quote.id}, ${quote.currency},
        ${recomputedSubtotal}, ${recomputedTax}, ${recomputedTotal}, ${params.userId}
      )
    `,
    ...computedLines.map(({ line, totals }, index) => sql`
      INSERT INTO commercial_invoice_lines (
        organisation_id, invoice_id, product_id, source_quote_line_id, position,
        description_snapshot, sku_snapshot, unit_snapshot, quantity, unit_price_cents,
        tax_code_snapshot, tax_rate_snapshot, line_subtotal_cents, line_tax_cents, line_total_cents
      ) VALUES (
        ${params.organisationId}, ${invoiceId}, ${line.product_id}, ${line.id}, ${index + 1},
        ${line.description_snapshot}, ${line.sku_snapshot}, ${line.unit_snapshot}, ${line.quantity}, ${line.unit_price_cents},
        ${line.tax_code_snapshot}, ${Number(line.tax_rate_snapshot)}, ${totals.line_subtotal_cents}, ${totals.line_tax_cents}, ${totals.line_total_cents}
      )
    `),
  ];
  await sql.transaction(queries);

  const invoice = await getInvoice(params.organisationId, invoiceId);
  if (!invoice) throw new Error('invoice creation from quote failed unexpectedly');

  await logInvoiceCreatedFromQuote({
    organisationId: params.organisationId, userId: params.userId, invoiceId: invoice.id,
    sourceQuoteId: quote.id, after: { customer_id: invoice.customer_id, currency: invoice.currency, total_cents: invoice.total_cents },
  });

  return invoice;
}

// DRAFT-only. Customer/notes/terms/due-date/payment-terms are editable;
// currency is fixed at creation, mirroring updateDraftQuote()'s identical
// rationale (lines already carry their own price/tax snapshots
// denominated in the original currency).
export async function updateDraftInvoice(params: {
  organisationId: string;
  userId: string;
  invoiceId: string;
  customerId?: string;
  notes?: string | null;
  terms?: string | null;
  dueDate?: string | null;
  paymentTermsDays?: number | null;
}): Promise<CommercialInvoice | null> {
  const before = await getInvoice(params.organisationId, params.invoiceId);
  if (!before) return null;
  assertInvoiceEditable(before.status);

  if (params.customerId) {
    const customer = await getCustomer(params.organisationId, params.customerId);
    if (!customer) throw new Error('customer_id not found for this organisation');
  }

  const rows = (await sql`
    UPDATE commercial_invoices SET
      customer_id = COALESCE(${params.customerId ?? null}, customer_id),
      notes = COALESCE(${params.notes}, notes),
      terms = COALESCE(${params.terms}, terms),
      due_date = COALESCE(${params.dueDate}, due_date),
      payment_terms_days = COALESCE(${params.paymentTermsDays ?? null}, payment_terms_days),
      updated_at = now()
    WHERE id = ${params.invoiceId} AND organisation_id = ${params.organisationId} AND status = 'DRAFT'
    RETURNING *
  `) as CommercialInvoice[];
  const after = rows[0];
  if (!after) return null;

  await logInvoiceUpdated({
    organisationId: params.organisationId, userId: params.userId, invoiceId: params.invoiceId,
    before: { customer_id: before.customer_id }, after: { customer_id: after.customer_id },
  });

  return after;
}

// DRAFT-only. Lines cascade-delete via commercial_invoice_lines' own ON
// DELETE CASCADE FK to commercial_invoices. The source quote (if any) is
// never touched — deleting a draft invoice has no effect on the quote it
// was created from.
export async function deleteDraftInvoice(params: { organisationId: string; userId: string; invoiceId: string }): Promise<boolean> {
  const rows = (await sql`
    DELETE FROM commercial_invoices
    WHERE id = ${params.invoiceId} AND organisation_id = ${params.organisationId} AND status = 'DRAFT'
    RETURNING id
  `) as { id: string }[];
  if (rows.length === 0) return false;

  await logInvoiceDeleted({ organisationId: params.organisationId, userId: params.userId, invoiceId: params.invoiceId });
  return true;
}

// ── Lines ─────────────────────────────────────────────────────────────

// Snapshots description/SKU/unit/price/tax-code/tax-rate at the moment
// the line is created (from the selected product's CURRENT values, with
// any explicitly-supplied override winning) — never re-derived from a
// live join afterward. Only legal while the parent invoice is DRAFT.
// Mirrors addQuoteLine() exactly.
export async function addInvoiceLine(params: {
  organisationId: string;
  invoiceId: string;
  productId?: string | null;
  description?: string;
  quantity: number;
  unitPriceCents?: number;
  taxCodeId?: string | null;
}): Promise<CommercialInvoiceLine> {
  const invoice = await getInvoice(params.organisationId, params.invoiceId);
  if (!invoice) throw new Error('invoice not found for this organisation');
  assertInvoiceEditable(invoice.status);

  if (!Number.isInteger(params.quantity) || params.quantity <= 0) {
    throw new Error('quantity must be a positive integer');
  }

  let description = params.description ?? null;
  let sku: string | null = null;
  let unit: string | null = null;
  let unitPriceCents = params.unitPriceCents;
  let taxCodeId = params.taxCodeId ?? null;

  if (params.productId) {
    const product = await getProduct(params.organisationId, params.productId);
    if (!product) throw new Error('product_id not found for this organisation');
    description = description ?? product.name;
    sku = product.sku;
    unit = product.unit_label;
    if (unitPriceCents === undefined) unitPriceCents = product.default_unit_price_cents;
    if (taxCodeId === null && params.taxCodeId === undefined) taxCodeId = product.default_tax_code_id;
  }

  if (!description) throw new Error('description is required (either directly or via product_id)');
  if (unitPriceCents === undefined || !isValidCents(unitPriceCents)) {
    throw new Error('unitPriceCents must be a non-negative integer');
  }

  let taxCodeSnapshot: string | null = null;
  let taxRateSnapshot = 0;
  if (taxCodeId) {
    const taxCode = await getTaxCode(params.organisationId, taxCodeId);
    if (!taxCode) throw new Error('tax_code_id not found for this organisation');
    taxCodeSnapshot = taxCode.code;
    taxRateSnapshot = Number(taxCode.rate);
  }

  const { line_subtotal_cents, line_tax_cents, line_total_cents } = computeLineTotals(unitPriceCents, params.quantity, taxRateSnapshot);

  const [{ next_position }] = (await sql`
    SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM commercial_invoice_lines
    WHERE invoice_id = ${params.invoiceId} AND organisation_id = ${params.organisationId}
  `) as { next_position: number }[];

  const rows = (await sql`
    INSERT INTO commercial_invoice_lines (
      organisation_id, invoice_id, product_id, position, description_snapshot, sku_snapshot, unit_snapshot,
      quantity, unit_price_cents, tax_code_snapshot, tax_rate_snapshot, line_subtotal_cents, line_tax_cents, line_total_cents
    ) VALUES (
      ${params.organisationId}, ${params.invoiceId}, ${params.productId ?? null}, ${next_position}, ${description}, ${sku}, ${unit},
      ${params.quantity}, ${unitPriceCents}, ${taxCodeSnapshot}, ${taxRateSnapshot}, ${line_subtotal_cents}, ${line_tax_cents}, ${line_total_cents}
    )
    RETURNING *
  `) as CommercialInvoiceLine[];

  await recalculateInvoiceTotals(params.organisationId, params.invoiceId);
  return rows[0];
}

// Only description/quantity/unitPriceCents/taxCodeId/position may change
// on an existing line — product_id is fixed at line-creation time.
// Mirrors updateQuoteLine() exactly.
export async function updateInvoiceLine(params: {
  organisationId: string;
  invoiceId: string;
  lineId: string;
  description?: string;
  quantity?: number;
  unitPriceCents?: number;
  taxCodeId?: string | null;
  position?: number;
}): Promise<CommercialInvoiceLine | null> {
  const invoice = await getInvoice(params.organisationId, params.invoiceId);
  if (!invoice) return null;
  assertInvoiceEditable(invoice.status);

  const existingRows = (await sql`
    SELECT * FROM commercial_invoice_lines WHERE id = ${params.lineId} AND invoice_id = ${params.invoiceId} AND organisation_id = ${params.organisationId}
  `) as CommercialInvoiceLine[];
  const existing = existingRows[0];
  if (!existing) return null;

  const quantity = params.quantity ?? existing.quantity;
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('quantity must be a positive integer');

  const unitPriceCents = params.unitPriceCents ?? existing.unit_price_cents;
  if (!isValidCents(unitPriceCents)) throw new Error('unitPriceCents must be a non-negative integer');

  let taxCodeSnapshot = existing.tax_code_snapshot;
  let taxRateSnapshot = Number(existing.tax_rate_snapshot);
  if (params.taxCodeId !== undefined) {
    if (params.taxCodeId === null) {
      taxCodeSnapshot = null;
      taxRateSnapshot = 0;
    } else {
      const taxCode = await getTaxCode(params.organisationId, params.taxCodeId);
      if (!taxCode) throw new Error('tax_code_id not found for this organisation');
      taxCodeSnapshot = taxCode.code;
      taxRateSnapshot = Number(taxCode.rate);
    }
  }

  const { line_subtotal_cents, line_tax_cents, line_total_cents } = computeLineTotals(unitPriceCents, quantity, taxRateSnapshot);

  const rows = (await sql`
    UPDATE commercial_invoice_lines SET
      description_snapshot = COALESCE(${params.description ?? null}, description_snapshot),
      quantity = ${quantity},
      unit_price_cents = ${unitPriceCents},
      tax_code_snapshot = ${taxCodeSnapshot},
      tax_rate_snapshot = ${taxRateSnapshot},
      line_subtotal_cents = ${line_subtotal_cents},
      line_tax_cents = ${line_tax_cents},
      line_total_cents = ${line_total_cents},
      position = COALESCE(${params.position ?? null}, position),
      updated_at = now()
    WHERE id = ${params.lineId} AND invoice_id = ${params.invoiceId} AND organisation_id = ${params.organisationId}
    RETURNING *
  `) as CommercialInvoiceLine[];

  await recalculateInvoiceTotals(params.organisationId, params.invoiceId);
  return rows[0];
}

export async function deleteInvoiceLine(params: { organisationId: string; invoiceId: string; lineId: string }): Promise<boolean> {
  const invoice = await getInvoice(params.organisationId, params.invoiceId);
  if (!invoice) return false;
  assertInvoiceEditable(invoice.status);

  const rows = (await sql`
    DELETE FROM commercial_invoice_lines
    WHERE id = ${params.lineId} AND invoice_id = ${params.invoiceId} AND organisation_id = ${params.organisationId}
    RETURNING id
  `) as { id: string }[];
  if (rows.length === 0) return false;

  await recalculateInvoiceTotals(params.organisationId, params.invoiceId);
  return true;
}

// ── Lifecycle transitions ────────────────────────────────────────────

// Phase C4.1R — replaces the previous two-step "allocate a document
// number, then separately UPDATE ... WHERE status = 'DRAFT'" sequence.
// That sequence relied on allocateDocumentNumber() (lib/commercial/
// documentNumbering.ts), which commits its OWN, fully independent
// sql.transaction() before the status-guarded UPDATE even runs — so a
// losing concurrent caller had already consumed a real INVOICE number by
// the time its own UPDATE discovered the invoice was no longer DRAFT.
// Proven empirically against a real Neon Preview branch: 10 concurrent
// issueInvoice() calls on ONE draft invoice produced exactly 1 successful
// ISSUED transition but consumed all 10 sequence values.
//
// issueInvoiceAtomically() below closes this by making "prove the
// invoice is still DRAFT", "allocate exactly one INVOICE number", and
// "transition to ISSUED" ONE compound SQL statement — a single
// network round-trip Postgres executes as one atomic unit, deliberately
// NOT lib/commercial/documentNumbering.ts's own two-call
// sql.transaction() primitive (that primitive requires a flat,
// pre-built query array with no branching on an earlier statement's own
// result within the same call — exactly the capability this fix
// needs). This is intentionally invoice-only: quoteLifecycle.ts's own
// issueQuote() keeps its pre-existing, already-shipped-to-production
// two-step shape unchanged (see this function's own note below) —
// remediating that is explicitly out of this phase's scope and is
// recorded as separate technical debt.
async function issueInvoiceAtomically(params: {
  organisationId: string;
  invoiceId: string;
  userId: string;
  customer: { name: string; billing_address: string | null; billing_email: string | null; billing_phone: string | null; tax_business_number: string | null };
}): Promise<CommercialInvoice | null> {
  // Unconditional, idempotent, and harmless regardless of the target
  // invoice's status — this only guarantees a counter row exists to
  // increment; it can never itself consume or leak a number. Kept as a
  // separate, PRECEDING statement rather than a fourth CTE below: sibling
  // CTEs in one WITH clause share a single statement-start snapshot, so a
  // CTE inserting this row for the very first time would not be visible
  // to a sibling CTE's own read of it within that SAME statement.
  await sql`
    INSERT INTO commercial_document_sequences (organisation_id, document_type, prefix, next_number, padding)
    VALUES (${params.organisationId}, 'INVOICE', 'INV-', 1, 6)
    ON CONFLICT (organisation_id, document_type) DO NOTHING
  `;

  // `guard` uses SELECT ... FOR UPDATE to take a row-level lock on the
  // invoice row itself. Under Postgres's standard READ COMMITTED
  // semantics, a second concurrent call racing on the SAME invoice row
  // blocks on that lock until the first call's statement (its own
  // implicit transaction) commits, then re-reads the row's now-current
  // status rather than a stale one. Because the loser's guard therefore
  // sees status = 'ISSUED' (the winner's already-committed value), its
  // guard CTE returns zero rows — and since `seq`'s own UPDATE is gated
  // by `EXISTS (SELECT 1 FROM guard)`, the loser's statement never
  // increments commercial_document_sequences AT ALL. Not "allocates then
  // discards" — genuinely never touches it. Exactly one number is
  // consumed per successful transition, by construction of a single
  // atomic statement, not by convention or a best-effort retry.
  const rows = (await sql`
    WITH guard AS (
      SELECT id FROM commercial_invoices
      WHERE id = ${params.invoiceId} AND organisation_id = ${params.organisationId} AND status = 'DRAFT'
      FOR UPDATE
    ),
    seq AS (
      UPDATE commercial_document_sequences
      SET next_number = next_number + 1, updated_at = now()
      WHERE organisation_id = ${params.organisationId} AND document_type = 'INVOICE'
        AND EXISTS (SELECT 1 FROM guard)
      RETURNING (next_number - 1) AS allocated_number, prefix, padding
    )
    UPDATE commercial_invoices SET
      status = 'ISSUED',
      invoice_number = (SELECT prefix || lpad(allocated_number::text, padding, '0') FROM seq),
      issue_date = COALESCE(issue_date, CURRENT_DATE),
      issued_by = ${params.userId},
      issued_at = now(),
      customer_name_snapshot = ${params.customer.name},
      billing_name_snapshot = ${params.customer.name},
      billing_address_snapshot = ${params.customer.billing_address},
      email_snapshot = ${params.customer.billing_email},
      phone_snapshot = ${params.customer.billing_phone},
      tax_identifier_snapshot = ${params.customer.tax_business_number},
      updated_at = now()
    WHERE id = ${params.invoiceId} AND organisation_id = ${params.organisationId} AND status = 'DRAFT'
      AND EXISTS (SELECT 1 FROM seq)
    RETURNING *
  `) as CommercialInvoice[];

  return rows[0] ?? null;
}

// Phase C4.1 §10 — issue requires: at least one line, a same-org
// customer that still exists, and a due_date already set (no
// organisation-level default terms exist yet in C4.1 — see the C4.0
// architecture report's §I — so an invoice with no due_date configured
// must be rejected rather than silently issued with a null due date).
// The lifecycle/precondition checks below run BEFORE the atomic
// statement — a request that fails one of these never reaches numbering
// at all, exactly like before. Only the actual "allocate + transition"
// step changed (see issueInvoiceAtomically()'s own header above).
export async function issueInvoice(params: { organisationId: string; userId: string; invoiceId: string }): Promise<CommercialInvoice> {
  const bundle = await getInvoiceWithLines(params.organisationId, params.invoiceId);
  if (!bundle) throw new Error('invoice not found for this organisation');
  const { invoice, lines } = bundle;
  assertInvoiceTransition(invoice.status, 'ISSUED');

  if (lines.length === 0) throw new Error('cannot issue an invoice with no lines');
  if (!invoice.due_date) throw new Error('cannot issue an invoice with no due date set');

  const customer = await getCustomer(params.organisationId, invoice.customer_id);
  if (!customer) throw new Error('customer not found for this organisation');

  await recalculateInvoiceTotals(params.organisationId, params.invoiceId);

  const issued = await issueInvoiceAtomically({
    organisationId: params.organisationId,
    invoiceId: params.invoiceId,
    userId: params.userId,
    customer,
  });
  if (!issued) throw new Error('invoice status changed concurrently; issue aborted (the atomic guard prevented any number from being consumed)');

  await logInvoiceIssued({
    organisationId: params.organisationId, userId: params.userId, invoiceId: params.invoiceId,
    invoiceNumber: issued.invoice_number!, totalCents: issued.total_cents,
  });

  return issued;
}

// Phase C4.1 §11 — only an ISSUED invoice may be voided; a non-empty,
// trimmed void_reason is mandatory. Retains invoice_number, totals,
// lines, and every snapshot field untouched — VOID never deletes or
// renumbers anything, matching the "immutable issued financial document"
// principle from the C4.0 architecture report exactly. No refund/payment
// behavior of any kind (no payment-allocation subsystem exists — see
// invoiceLifecycle.ts's own header).
export async function voidInvoice(params: { organisationId: string; userId: string; invoiceId: string; voidReason: string }): Promise<CommercialInvoice> {
  const trimmedReason = params.voidReason.trim();
  if (!trimmedReason) throw new Error('void_reason is required');

  const invoice = await getInvoice(params.organisationId, params.invoiceId);
  if (!invoice) throw new Error('invoice not found for this organisation');
  assertInvoiceTransition(invoice.status, 'VOID');

  const rows = (await sql`
    UPDATE commercial_invoices SET status = 'VOID', voided_by = ${params.userId}, voided_at = now(), void_reason = ${trimmedReason}, updated_at = now()
    WHERE id = ${params.invoiceId} AND organisation_id = ${params.organisationId} AND status = 'ISSUED'
    RETURNING *
  `) as CommercialInvoice[];
  const voided = rows[0];
  if (!voided) throw new Error('invoice status changed concurrently; void aborted');

  await logInvoiceVoided({ organisationId: params.organisationId, userId: params.userId, invoiceId: params.invoiceId, voidReason: trimmedReason });
  return voided;
}
