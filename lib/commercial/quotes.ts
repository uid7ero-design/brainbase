import sql from '@/lib/db';
import { getCustomer } from './customers';
import { getProduct } from './products';
import { getTaxCode } from './taxCodes';
import { allocateDocumentNumber } from './documentNumbering';
import { sumCents, lineTotalCents, applyRatePercentCents, isValidCents } from './money';
import { assertQuoteTransition, assertQuoteEditable, type QuoteStatus } from './quoteLifecycle';
import {
  logQuoteCreated, logQuoteUpdated, logQuoteIssued, logQuoteAccepted,
  logQuoteRejected, logQuoteExpired, logQuoteDeleted,
} from './auditLog';

// Phase C3 — tenant-scoped data access + business logic for
// commercial_quotes/commercial_quote_lines. Same discipline as every
// other lib/commercial/*.ts module: organisationId is always an explicit
// caller-supplied parameter (never resolved internally), every query is
// scoped by it, and structural tenant isolation (the composite FKs in
// scripts/create-commercial-quotes.sql) backs up every application-level
// check rather than being the only line of defence.

export interface CommercialQuote {
  id: string;
  organisation_id: string;
  customer_id: string;
  quote_number: string | null;
  status: QuoteStatus;
  currency: string;
  issue_date: string | null;
  expiry_date: string | null;
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
  created_at: string;
  updated_at: string;
  issued_at: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  expired_at: string | null;
}

export interface CommercialQuoteLine {
  id: string;
  organisation_id: string;
  quote_id: string;
  product_id: string | null;
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

export async function listQuotes(organisationId: string, opts: { status?: QuoteStatus } = {}): Promise<CommercialQuote[]> {
  if (opts.status) {
    return (await sql`
      SELECT * FROM commercial_quotes WHERE organisation_id = ${organisationId} AND status = ${opts.status}
      ORDER BY created_at DESC
    `) as CommercialQuote[];
  }
  return (await sql`
    SELECT * FROM commercial_quotes WHERE organisation_id = ${organisationId} ORDER BY created_at DESC
  `) as CommercialQuote[];
}

// Returns null both for "does not exist" and "exists but belongs to a
// different organisation" — same indistinguishable-by-design rule as
// every other getX() in this Commercial module.
export async function getQuote(organisationId: string, quoteId: string): Promise<CommercialQuote | null> {
  const rows = (await sql`
    SELECT * FROM commercial_quotes WHERE id = ${quoteId} AND organisation_id = ${organisationId}
  `) as CommercialQuote[];
  return rows[0] ?? null;
}

export async function listQuoteLines(organisationId: string, quoteId: string): Promise<CommercialQuoteLine[]> {
  return (await sql`
    SELECT * FROM commercial_quote_lines
    WHERE quote_id = ${quoteId} AND organisation_id = ${organisationId}
    ORDER BY position ASC, created_at ASC
  `) as CommercialQuoteLine[];
}

export async function getQuoteWithLines(organisationId: string, quoteId: string): Promise<{ quote: CommercialQuote; lines: CommercialQuoteLine[] } | null> {
  const quote = await getQuote(organisationId, quoteId);
  if (!quote) return null;
  const lines = await listQuoteLines(organisationId, quoteId);
  return { quote, lines };
}

// Recomputes and persists subtotal_cents/tax_cents/total_cents from the
// CURRENT set of line rows — the single source of truth for quote-level
// totals (per the C3 brief's §10 "Quote totals must derive
// deterministically from line snapshots"). Called after every line
// mutation and once more, defensively, at issue time.
async function recalculateQuoteTotals(organisationId: string, quoteId: string): Promise<void> {
  const lines = await listQuoteLines(organisationId, quoteId);
  const subtotal = sumCents(lines.map(l => l.line_subtotal_cents));
  const tax = sumCents(lines.map(l => l.line_tax_cents));
  const total = sumCents(lines.map(l => l.line_total_cents));
  await sql`
    UPDATE commercial_quotes SET subtotal_cents = ${subtotal}, tax_cents = ${tax}, total_cents = ${total}, updated_at = now()
    WHERE id = ${quoteId} AND organisation_id = ${organisationId}
  `;
}

export async function createDraftQuote(params: {
  organisationId: string;
  userId: string;
  customerId: string;
  currency?: string;
  notes?: string | null;
  terms?: string | null;
  expiryDate?: string | null;
}): Promise<CommercialQuote> {
  // Friendly, non-enumerable pre-check before the INSERT — the composite
  // FK (commercial_quotes_customer_org_fkey) is the actual structural
  // guarantee; this check exists only so a cross-tenant/nonexistent
  // customer_id fails with a clear application error instead of a raw
  // Postgres FK-violation surfacing to the API layer.
  const customer = await getCustomer(params.organisationId, params.customerId);
  if (!customer) throw new Error('customer_id not found for this organisation');

  const rows = (await sql`
    INSERT INTO commercial_quotes (organisation_id, customer_id, currency, notes, terms, expiry_date, created_by)
    VALUES (
      ${params.organisationId}, ${params.customerId}, ${params.currency ?? 'AUD'},
      ${params.notes ?? null}, ${params.terms ?? null}, ${params.expiryDate ?? null}, ${params.userId}
    )
    RETURNING *
  `) as CommercialQuote[];
  const quote = rows[0];

  await logQuoteCreated({
    organisationId: params.organisationId, userId: params.userId, quoteId: quote.id,
    after: { customer_id: quote.customer_id, currency: quote.currency },
  });

  return quote;
}

// DRAFT-only. Customer/notes/terms/expiry are editable; currency is
// fixed at creation (the C3 brief scopes C3 to a single quote currency,
// and changing it after lines with their own price/tax snapshots exist
// would leave those figures denominated in the wrong currency).
export async function updateDraftQuote(params: {
  organisationId: string;
  userId: string;
  quoteId: string;
  customerId?: string;
  notes?: string | null;
  terms?: string | null;
  expiryDate?: string | null;
}): Promise<CommercialQuote | null> {
  const before = await getQuote(params.organisationId, params.quoteId);
  if (!before) return null;
  assertQuoteEditable(before.status);

  if (params.customerId) {
    const customer = await getCustomer(params.organisationId, params.customerId);
    if (!customer) throw new Error('customer_id not found for this organisation');
  }

  const rows = (await sql`
    UPDATE commercial_quotes SET
      customer_id = COALESCE(${params.customerId ?? null}, customer_id),
      notes = COALESCE(${params.notes}, notes),
      terms = COALESCE(${params.terms}, terms),
      expiry_date = COALESCE(${params.expiryDate}, expiry_date),
      updated_at = now()
    WHERE id = ${params.quoteId} AND organisation_id = ${params.organisationId} AND status = 'DRAFT'
    RETURNING *
  `) as CommercialQuote[];
  const after = rows[0];
  if (!after) return null;

  await logQuoteUpdated({
    organisationId: params.organisationId, userId: params.userId, quoteId: params.quoteId,
    before: { customer_id: before.customer_id }, after: { customer_id: after.customer_id },
  });

  return after;
}

// DRAFT-only. draft deletion is a genuine, narrow-scope UX need (a
// quote started by mistake) — never permitted once a quote has left
// DRAFT (see the C3 brief's explicit "No delete for issued quotes").
// Lines cascade-delete via commercial_quote_lines' own ON DELETE CASCADE
// FK to commercial_quotes.
export async function deleteDraftQuote(params: { organisationId: string; userId: string; quoteId: string }): Promise<boolean> {
  const rows = (await sql`
    DELETE FROM commercial_quotes
    WHERE id = ${params.quoteId} AND organisation_id = ${params.organisationId} AND status = 'DRAFT'
    RETURNING id
  `) as { id: string }[];
  if (rows.length === 0) return false;

  await logQuoteDeleted({ organisationId: params.organisationId, userId: params.userId, quoteId: params.quoteId });
  return true;
}

// ── Lines ─────────────────────────────────────────────────────────────

function computeLineTotals(unitPriceCents: number, quantity: number, taxRatePercent: number) {
  const line_subtotal_cents = lineTotalCents(unitPriceCents, quantity);
  const line_tax_cents = applyRatePercentCents(line_subtotal_cents, taxRatePercent);
  const line_total_cents = line_subtotal_cents + line_tax_cents;
  return { line_subtotal_cents, line_tax_cents, line_total_cents };
}

// Snapshots description/SKU/unit/price/tax-code/tax-rate at the moment
// the line is created (from the selected product's CURRENT values, with
// any explicitly-supplied override winning) — never re-derived from a
// live join afterward. Only legal while the parent quote is DRAFT.
export async function addQuoteLine(params: {
  organisationId: string;
  quoteId: string;
  productId?: string | null;
  description?: string;
  quantity: number;
  unitPriceCents?: number;
  taxCodeId?: string | null;
}): Promise<CommercialQuoteLine> {
  const quote = await getQuote(params.organisationId, params.quoteId);
  if (!quote) throw new Error('quote not found for this organisation');
  assertQuoteEditable(quote.status);

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
    SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM commercial_quote_lines
    WHERE quote_id = ${params.quoteId} AND organisation_id = ${params.organisationId}
  `) as { next_position: number }[];

  const rows = (await sql`
    INSERT INTO commercial_quote_lines (
      organisation_id, quote_id, product_id, position, description_snapshot, sku_snapshot, unit_snapshot,
      quantity, unit_price_cents, tax_code_snapshot, tax_rate_snapshot, line_subtotal_cents, line_tax_cents, line_total_cents
    ) VALUES (
      ${params.organisationId}, ${params.quoteId}, ${params.productId ?? null}, ${next_position}, ${description}, ${sku}, ${unit},
      ${params.quantity}, ${unitPriceCents}, ${taxCodeSnapshot}, ${taxRateSnapshot}, ${line_subtotal_cents}, ${line_tax_cents}, ${line_total_cents}
    )
    RETURNING *
  `) as CommercialQuoteLine[];

  await recalculateQuoteTotals(params.organisationId, params.quoteId);
  return rows[0];
}

// Only description/quantity/unitPriceCents/taxCodeId/position may change
// on an existing line — product_id is fixed at line-creation time (to
// re-point a line at a different product, delete it and add a new one).
export async function updateQuoteLine(params: {
  organisationId: string;
  quoteId: string;
  lineId: string;
  description?: string;
  quantity?: number;
  unitPriceCents?: number;
  taxCodeId?: string | null;
  position?: number;
}): Promise<CommercialQuoteLine | null> {
  const quote = await getQuote(params.organisationId, params.quoteId);
  if (!quote) return null;
  assertQuoteEditable(quote.status);

  const existingRows = (await sql`
    SELECT * FROM commercial_quote_lines WHERE id = ${params.lineId} AND quote_id = ${params.quoteId} AND organisation_id = ${params.organisationId}
  `) as CommercialQuoteLine[];
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
    UPDATE commercial_quote_lines SET
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
    WHERE id = ${params.lineId} AND quote_id = ${params.quoteId} AND organisation_id = ${params.organisationId}
    RETURNING *
  `) as CommercialQuoteLine[];

  await recalculateQuoteTotals(params.organisationId, params.quoteId);
  return rows[0];
}

export async function deleteQuoteLine(params: { organisationId: string; quoteId: string; lineId: string }): Promise<boolean> {
  const quote = await getQuote(params.organisationId, params.quoteId);
  if (!quote) return false;
  assertQuoteEditable(quote.status);

  const rows = (await sql`
    DELETE FROM commercial_quote_lines
    WHERE id = ${params.lineId} AND quote_id = ${params.quoteId} AND organisation_id = ${params.organisationId}
    RETURNING id
  `) as { id: string }[];
  if (rows.length === 0) return false;

  await recalculateQuoteTotals(params.organisationId, params.quoteId);
  return true;
}

// ── Lifecycle transitions ────────────────────────────────────────────
//
// Each function below: (1) loads the quote, (2) asks
// quoteLifecycle.assertQuoteTransition() whether the requested move is
// legal — the single source of truth for the whole state machine — then
// (3) performs one UPDATE that ALSO re-checks the expected `status` in
// its WHERE clause (defence against a race between two concurrent
// requests for the same quote), then (4) audits the transition.

export async function issueQuote(params: { organisationId: string; userId: string; quoteId: string }): Promise<CommercialQuote> {
  const bundle = await getQuoteWithLines(params.organisationId, params.quoteId);
  if (!bundle) throw new Error('quote not found for this organisation');
  const { quote, lines } = bundle;
  assertQuoteTransition(quote.status, 'SENT');

  if (lines.length === 0) throw new Error('cannot issue a quote with no lines');

  const customer = await getCustomer(params.organisationId, quote.customer_id);
  if (!customer) throw new Error('customer not found for this organisation');

  await recalculateQuoteTotals(params.organisationId, params.quoteId);

  // Allocation happens BEFORE the state-changing UPDATE and cannot share
  // one atomic transaction with it: allocateDocumentNumber() already
  // uses Neon's own non-interactive sql.transaction() internally (see
  // lib/commercial/documentNumbering.ts), and that primitive requires a
  // flat, pre-built query array with no branching on an earlier
  // statement's own result within the same call — the allocated number
  // literally does not exist yet when the UPDATE's query would need to
  // be constructed. In the extremely unlikely event the UPDATE below
  // affects zero rows (a concurrent request already moved this exact
  // quote out of DRAFT between the read above and here), the allocated
  // number is not consumed by any quote and becomes a permanent gap —
  // an accepted, documented edge case of the same class as a deleted
  // draft never having sent, not a correctness bug.
  const quoteNumber = await allocateDocumentNumber(params.organisationId, 'QUOTE');

  const rows = (await sql`
    UPDATE commercial_quotes SET
      status = 'SENT',
      quote_number = ${quoteNumber},
      issue_date = COALESCE(issue_date, CURRENT_DATE),
      issued_by = ${params.userId},
      issued_at = now(),
      customer_name_snapshot = ${customer.name},
      billing_name_snapshot = ${customer.name},
      billing_address_snapshot = ${customer.billing_address},
      email_snapshot = ${customer.billing_email},
      phone_snapshot = ${customer.billing_phone},
      tax_identifier_snapshot = ${customer.tax_business_number},
      updated_at = now()
    WHERE id = ${params.quoteId} AND organisation_id = ${params.organisationId} AND status = 'DRAFT'
    RETURNING *
  `) as CommercialQuote[];
  const issued = rows[0];
  if (!issued) throw new Error('quote status changed concurrently; issue aborted (a document number was allocated and not consumed)');

  await logQuoteIssued({
    organisationId: params.organisationId, userId: params.userId, quoteId: params.quoteId,
    quoteNumber: issued.quote_number!, totalCents: issued.total_cents,
  });

  return issued;
}

export async function acceptQuote(params: { organisationId: string; userId: string; quoteId: string }): Promise<CommercialQuote> {
  const quote = await getQuote(params.organisationId, params.quoteId);
  if (!quote) throw new Error('quote not found for this organisation');
  assertQuoteTransition(quote.status, 'ACCEPTED');

  const rows = (await sql`
    UPDATE commercial_quotes SET status = 'ACCEPTED', accepted_at = now(), updated_at = now()
    WHERE id = ${params.quoteId} AND organisation_id = ${params.organisationId} AND status = 'SENT'
    RETURNING *
  `) as CommercialQuote[];
  const accepted = rows[0];
  if (!accepted) throw new Error('quote status changed concurrently; accept aborted');

  await logQuoteAccepted({ organisationId: params.organisationId, userId: params.userId, quoteId: params.quoteId });
  return accepted;
}

export async function rejectQuote(params: { organisationId: string; userId: string; quoteId: string }): Promise<CommercialQuote> {
  const quote = await getQuote(params.organisationId, params.quoteId);
  if (!quote) throw new Error('quote not found for this organisation');
  assertQuoteTransition(quote.status, 'REJECTED');

  const rows = (await sql`
    UPDATE commercial_quotes SET status = 'REJECTED', rejected_at = now(), updated_at = now()
    WHERE id = ${params.quoteId} AND organisation_id = ${params.organisationId} AND status = 'SENT'
    RETURNING *
  `) as CommercialQuote[];
  const rejected = rows[0];
  if (!rejected) throw new Error('quote status changed concurrently; reject aborted');

  await logQuoteRejected({ organisationId: params.organisationId, userId: params.userId, quoteId: params.quoteId });
  return rejected;
}

export async function expireQuote(params: { organisationId: string; userId: string; quoteId: string }): Promise<CommercialQuote> {
  const quote = await getQuote(params.organisationId, params.quoteId);
  if (!quote) throw new Error('quote not found for this organisation');
  assertQuoteTransition(quote.status, 'EXPIRED');

  const rows = (await sql`
    UPDATE commercial_quotes SET status = 'EXPIRED', expired_at = now(), updated_at = now()
    WHERE id = ${params.quoteId} AND organisation_id = ${params.organisationId} AND status = 'SENT'
    RETURNING *
  `) as CommercialQuote[];
  const expired = rows[0];
  if (!expired) throw new Error('quote status changed concurrently; expire aborted');

  await logQuoteExpired({ organisationId: params.organisationId, userId: params.userId, quoteId: params.quoteId });
  return expired;
}
