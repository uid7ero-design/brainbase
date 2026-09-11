import 'server-only';
import sql from '@/lib/db';
import { getSupplier } from './suppliers';
import { getProduct } from './products';
import { getTaxCode } from './taxCodes';
import { sumCents, lineTotalCents, applyRatePercentCents, isValidCents } from './money';
import { assertPurchaseOrderTransition, assertPurchaseOrderEditable, type PurchaseOrderStatus } from './purchaseOrderLifecycle';
import {
  logPurchaseOrderCreated, logPurchaseOrderUpdated, logPurchaseOrderDeleted, logPurchaseOrderSubmitted, logPurchaseOrderApproved,
  logPurchaseOrderReturned, logPurchaseOrderIssued, logPurchaseOrderCancelled,
} from './auditLog';

// Phase C6.2 — tenant-scoped data access + business logic for
// commercial_purchase_orders/commercial_purchase_order_lines. Same
// discipline as every other lib/commercial/*.ts module (see
// lib/commercial/invoices.ts, which this file mirrors closely):
// organisationId is always an explicit caller-supplied parameter (never
// resolved internally), every query is scoped by it, and structural
// tenant isolation (the composite FKs in
// scripts/create-commercial-purchasing.sql) backs up every
// application-level check rather than being the only line of defence.
//
// `import 'server-only'` above — this module imports lib/db and must
// never be reachable from a Client Component bundle.
//
// Deliberately duplicates, rather than imports, invoices.ts's/quotes.ts's
// private computeLineTotals()-shaped composition of the genuinely shared
// lib/commercial/money.ts primitives — a ~5-line function, not worth a
// cross-module dependency for, matching invoices.ts's own stated
// rationale for not importing quotes.ts's copy.
//
// No Purchase Request entity, no receiving, no bills/AP, no supplier
// payments, no budgeting/encumbrance engine, no email — all explicitly
// out of C6.2 scope per the C6 architecture review.

export interface CommercialPurchaseOrder {
  id: string;
  organisation_id: string;
  supplier_id: string;
  purchase_order_number: string | null;
  status: PurchaseOrderStatus;
  currency: string;
  cost_centre_id: string | null;
  supplier_reference: string | null;
  delivery_date: string | null;
  delivery_address_line1: string | null;
  delivery_address_line2: string | null;
  delivery_suburb: string | null;
  delivery_state: string | null;
  delivery_postcode: string | null;
  delivery_country: string | null;
  payment_terms_days: number | null;
  internal_notes: string | null;
  supplier_notes: string | null;
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
  payment_terms_days_snapshot: number | null;
  return_reason: string | null;
  cancel_reason: string | null;
  created_by: string | null;
  submitted_by: string | null;
  approved_by: string | null;
  issued_by: string | null;
  cancelled_by: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  approved_at: string | null;
  issued_at: string | null;
  cancelled_at: string | null;
}

export interface CommercialPurchaseOrderLine {
  id: string;
  organisation_id: string;
  purchase_order_id: string;
  product_id: string | null;
  cost_centre_id: string | null;
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

export async function listPurchaseOrders(organisationId: string, opts: { status?: PurchaseOrderStatus } = {}): Promise<CommercialPurchaseOrder[]> {
  if (opts.status) {
    return (await sql`
      SELECT * FROM commercial_purchase_orders WHERE organisation_id = ${organisationId} AND status = ${opts.status}
      ORDER BY created_at DESC
    `) as CommercialPurchaseOrder[];
  }
  return (await sql`
    SELECT * FROM commercial_purchase_orders WHERE organisation_id = ${organisationId} ORDER BY created_at DESC
  `) as CommercialPurchaseOrder[];
}

// Returns null both for "does not exist" and "exists but belongs to a
// different organisation" — matching every other Commercial get*()
// function's identical tenant-isolation discipline.
export async function getPurchaseOrder(organisationId: string, purchaseOrderId: string): Promise<CommercialPurchaseOrder | null> {
  const rows = (await sql`
    SELECT * FROM commercial_purchase_orders WHERE id = ${purchaseOrderId} AND organisation_id = ${organisationId}
  `) as CommercialPurchaseOrder[];
  return rows[0] ?? null;
}

export async function listPurchaseOrderLines(organisationId: string, purchaseOrderId: string): Promise<CommercialPurchaseOrderLine[]> {
  return (await sql`
    SELECT * FROM commercial_purchase_order_lines
    WHERE purchase_order_id = ${purchaseOrderId} AND organisation_id = ${organisationId}
    ORDER BY position ASC
  `) as CommercialPurchaseOrderLine[];
}

export async function getPurchaseOrderWithLines(
  organisationId: string, purchaseOrderId: string,
): Promise<{ purchaseOrder: CommercialPurchaseOrder; lines: CommercialPurchaseOrderLine[] } | null> {
  const purchaseOrder = await getPurchaseOrder(organisationId, purchaseOrderId);
  if (!purchaseOrder) return null;
  const lines = await listPurchaseOrderLines(organisationId, purchaseOrderId);
  return { purchaseOrder, lines };
}

// Recomputes and persists subtotal_cents/tax_cents/total_cents from the
// CURRENT set of line rows — the single source of truth for
// purchase-order-level totals, mirroring invoices.ts's
// recalculateInvoiceTotals() exactly. Called after every line mutation
// and once more, defensively, at issue time.
async function recalculatePurchaseOrderTotals(organisationId: string, purchaseOrderId: string): Promise<void> {
  const lines = await listPurchaseOrderLines(organisationId, purchaseOrderId);
  const subtotal = sumCents(lines.map(l => l.line_subtotal_cents));
  const tax = sumCents(lines.map(l => l.line_tax_cents));
  const total = sumCents(lines.map(l => l.line_total_cents));
  await sql`
    UPDATE commercial_purchase_orders SET subtotal_cents = ${subtotal}, tax_cents = ${tax}, total_cents = ${total}, updated_at = now()
    WHERE id = ${purchaseOrderId} AND organisation_id = ${organisationId}
  `;
}

function computeLineTotals(unitPriceCents: number, quantity: number, taxRatePercent: number) {
  const line_subtotal_cents = lineTotalCents(unitPriceCents, quantity);
  const line_tax_cents = applyRatePercentCents(line_subtotal_cents, taxRatePercent);
  const line_total_cents = line_subtotal_cents + line_tax_cents;
  return { line_subtotal_cents, line_tax_cents, line_total_cents };
}

// ── Header CRUD ──────────────────────────────────────────────────────

export async function createPurchaseOrder(params: {
  organisationId: string;
  userId: string;
  supplierId: string;
  currency?: string;
  costCentreId?: string | null;
  supplierReference?: string | null;
  deliveryDate?: string | null;
  deliveryAddressLine1?: string | null;
  deliveryAddressLine2?: string | null;
  deliverySuburb?: string | null;
  deliveryState?: string | null;
  deliveryPostcode?: string | null;
  deliveryCountry?: string | null;
  paymentTermsDays?: number | null;
  internalNotes?: string | null;
  supplierNotes?: string | null;
}): Promise<CommercialPurchaseOrder> {
  // Friendly, non-enumerable pre-check before the INSERT — the composite
  // FK (commercial_purchase_orders_supplier_org_fkey) is the actual
  // structural guarantee; this check exists only so a cross-tenant/
  // nonexistent supplier_id fails with a clear application error,
  // mirroring createDraftInvoice()'s identical precheck.
  const supplier = await getSupplier(params.organisationId, params.supplierId);
  if (!supplier) throw new Error('supplier_id not found for this organisation');

  if (params.paymentTermsDays != null && (!Number.isInteger(params.paymentTermsDays) || params.paymentTermsDays < 0)) {
    throw new Error('payment_terms_days must be a non-negative integer');
  }
  if (params.costCentreId) {
    const rows = await sql`SELECT id FROM commercial_cost_centres WHERE id = ${params.costCentreId} AND organisation_id = ${params.organisationId}`;
    if (rows.length === 0) throw new Error('cost_centre_id not found for this organisation');
  }

  const rows = (await sql`
    INSERT INTO commercial_purchase_orders (
      organisation_id, supplier_id, currency, cost_centre_id, supplier_reference, delivery_date,
      delivery_address_line1, delivery_address_line2, delivery_suburb, delivery_state, delivery_postcode, delivery_country,
      payment_terms_days, internal_notes, supplier_notes, created_by
    ) VALUES (
      ${params.organisationId}, ${params.supplierId}, ${params.currency ?? 'AUD'}, ${params.costCentreId ?? null},
      ${params.supplierReference ?? null}, ${params.deliveryDate ?? null},
      ${params.deliveryAddressLine1 ?? null}, ${params.deliveryAddressLine2 ?? null}, ${params.deliverySuburb ?? null},
      ${params.deliveryState ?? null}, ${params.deliveryPostcode ?? null}, ${params.deliveryCountry ?? null},
      ${params.paymentTermsDays ?? null}, ${params.internalNotes ?? null}, ${params.supplierNotes ?? null}, ${params.userId}
    )
    RETURNING *
  `) as CommercialPurchaseOrder[];
  const purchaseOrder = rows[0];

  await logPurchaseOrderCreated({
    organisationId: params.organisationId, userId: params.userId, purchaseOrderId: purchaseOrder.id,
    after: { supplier_id: purchaseOrder.supplier_id, currency: purchaseOrder.currency },
  });

  return purchaseOrder;
}

// DRAFT-only. Mirrors updateDraftInvoice() exactly: currency is fixed at
// creation (lines already carry their own price/tax snapshots
// denominated in the original currency).
export async function updateDraftPurchaseOrder(params: {
  organisationId: string;
  userId: string;
  purchaseOrderId: string;
  supplierId?: string;
  costCentreId?: string | null;
  supplierReference?: string | null;
  deliveryDate?: string | null;
  deliveryAddressLine1?: string | null;
  deliveryAddressLine2?: string | null;
  deliverySuburb?: string | null;
  deliveryState?: string | null;
  deliveryPostcode?: string | null;
  deliveryCountry?: string | null;
  paymentTermsDays?: number | null;
  internalNotes?: string | null;
  supplierNotes?: string | null;
}): Promise<CommercialPurchaseOrder | null> {
  const before = await getPurchaseOrder(params.organisationId, params.purchaseOrderId);
  if (!before) return null;
  assertPurchaseOrderEditable(before.status);

  if (params.supplierId) {
    const supplier = await getSupplier(params.organisationId, params.supplierId);
    if (!supplier) throw new Error('supplier_id not found for this organisation');
  }
  if (params.paymentTermsDays != null && (!Number.isInteger(params.paymentTermsDays) || params.paymentTermsDays < 0)) {
    throw new Error('payment_terms_days must be a non-negative integer');
  }
  if (params.costCentreId) {
    const rows = await sql`SELECT id FROM commercial_cost_centres WHERE id = ${params.costCentreId} AND organisation_id = ${params.organisationId}`;
    if (rows.length === 0) throw new Error('cost_centre_id not found for this organisation');
  }

  const rows = (await sql`
    UPDATE commercial_purchase_orders SET
      supplier_id = COALESCE(${params.supplierId ?? null}, supplier_id),
      cost_centre_id = COALESCE(${params.costCentreId ?? null}, cost_centre_id),
      supplier_reference = COALESCE(${params.supplierReference}, supplier_reference),
      delivery_date = COALESCE(${params.deliveryDate}, delivery_date),
      delivery_address_line1 = COALESCE(${params.deliveryAddressLine1}, delivery_address_line1),
      delivery_address_line2 = COALESCE(${params.deliveryAddressLine2}, delivery_address_line2),
      delivery_suburb = COALESCE(${params.deliverySuburb}, delivery_suburb),
      delivery_state = COALESCE(${params.deliveryState}, delivery_state),
      delivery_postcode = COALESCE(${params.deliveryPostcode}, delivery_postcode),
      delivery_country = COALESCE(${params.deliveryCountry}, delivery_country),
      payment_terms_days = COALESCE(${params.paymentTermsDays ?? null}, payment_terms_days),
      internal_notes = COALESCE(${params.internalNotes}, internal_notes),
      supplier_notes = COALESCE(${params.supplierNotes}, supplier_notes),
      updated_at = now()
    WHERE id = ${params.purchaseOrderId} AND organisation_id = ${params.organisationId} AND status = 'DRAFT'
    RETURNING *
  `) as CommercialPurchaseOrder[];
  const after = rows[0];
  if (!after) return null;

  await logPurchaseOrderUpdated({
    organisationId: params.organisationId, userId: params.userId, purchaseOrderId: params.purchaseOrderId,
    before: { supplier_id: before.supplier_id }, after: { supplier_id: after.supplier_id },
  });

  return after;
}

// C6.9 remediation — safe discard/delete for a never-issued DRAFT,
// mirroring deleteDraftInvoice()/deleteDraftQuote() exactly (same
// status-gated-in-the-WHERE-clause shape, same hard DELETE, same
// draft-only audit event). commercial_purchase_order_lines has
// ON DELETE CASCADE onto this table (see
// scripts/create-commercial-purchasing.sql), so line rows are cleaned up
// atomically by the database itself — no separate line-delete step, no
// orphan-row risk, no explicit transaction needed here.
//
// Eligibility is intentionally STRICTER than the quote/invoice
// precedent: status = 'DRAFT' AND purchase_order_number IS NULL (never
// issued — permanent numbering is assigned exactly once, at ISSUE, and
// is never cleared) AND submitted_at IS NULL (never even submitted for
// approval). That last condition is deliberate, not copied from quotes/
// invoices (which have no PENDING_APPROVAL/return concept at all): a PO
// that was submitted and then returned to DRAFT already carries real
// approval-workflow history (a submit + a return, each with their own
// audit event and a persisted return_reason) — hard-deleting it would
// silently orphan that trail's meaning ("why was this returned, by
// whom") with no PO left to explain it. Only a DRAFT that was NEVER
// submitted — exactly the shape of the abandoned first-attempt draft
// left over from the C6.8 Production smoke — is eligible. A
// once-submitted PO, even back in DRAFT after a return, must instead
// stay discoverable/editable and eventually re-submitted, cancelled (via
// re-submit → approve → issue → cancel), or left as a permanent DRAFT
// record — never silently erased.
export async function deleteDraftPurchaseOrder(params: {
  organisationId: string; userId: string; purchaseOrderId: string;
}): Promise<boolean> {
  const rows = (await sql`
    DELETE FROM commercial_purchase_orders
    WHERE id = ${params.purchaseOrderId} AND organisation_id = ${params.organisationId}
      AND status = 'DRAFT' AND purchase_order_number IS NULL AND submitted_at IS NULL
    RETURNING id
  `) as { id: string }[];
  if (rows.length === 0) return false;

  await logPurchaseOrderDeleted({ organisationId: params.organisationId, userId: params.userId, purchaseOrderId: params.purchaseOrderId });
  return true;
}

// ── Lines ─────────────────────────────────────────────────────────────
//
// Snapshots description/SKU/unit/price/tax-code/tax-rate at the moment
// the line is created (from the selected product's CURRENT values, with
// any explicitly-supplied override winning) — never re-derived from a
// live join afterward. Only legal while the parent purchase order is
// DRAFT. Mirrors addInvoiceLine() exactly.
export async function addPurchaseOrderLine(params: {
  organisationId: string;
  purchaseOrderId: string;
  productId?: string | null;
  description?: string;
  quantity: number;
  unitPriceCents?: number;
  taxCodeId?: string | null;
  costCentreId?: string | null;
}): Promise<CommercialPurchaseOrderLine> {
  const purchaseOrder = await getPurchaseOrder(params.organisationId, params.purchaseOrderId);
  if (!purchaseOrder) throw new Error('purchase order not found for this organisation');
  assertPurchaseOrderEditable(purchaseOrder.status);

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

  if (params.costCentreId) {
    const rows = await sql`SELECT id FROM commercial_cost_centres WHERE id = ${params.costCentreId} AND organisation_id = ${params.organisationId}`;
    if (rows.length === 0) throw new Error('cost_centre_id not found for this organisation');
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
    SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM commercial_purchase_order_lines
    WHERE purchase_order_id = ${params.purchaseOrderId} AND organisation_id = ${params.organisationId}
  `) as { next_position: number }[];

  const rows = (await sql`
    INSERT INTO commercial_purchase_order_lines (
      organisation_id, purchase_order_id, product_id, cost_centre_id, position, description_snapshot, sku_snapshot, unit_snapshot,
      quantity, unit_price_cents, tax_code_snapshot, tax_rate_snapshot, line_subtotal_cents, line_tax_cents, line_total_cents
    ) VALUES (
      ${params.organisationId}, ${params.purchaseOrderId}, ${params.productId ?? null}, ${params.costCentreId ?? null}, ${next_position},
      ${description}, ${sku}, ${unit}, ${params.quantity}, ${unitPriceCents}, ${taxCodeSnapshot}, ${taxRateSnapshot},
      ${line_subtotal_cents}, ${line_tax_cents}, ${line_total_cents}
    )
    RETURNING *
  `) as CommercialPurchaseOrderLine[];

  await recalculatePurchaseOrderTotals(params.organisationId, params.purchaseOrderId);
  return rows[0];
}

// Only description/quantity/unitPriceCents/taxCodeId/costCentreId may
// change on an existing line — product_id is fixed at line-creation
// time. Mirrors updateInvoiceLine() exactly.
export async function updatePurchaseOrderLine(params: {
  organisationId: string;
  purchaseOrderId: string;
  lineId: string;
  description?: string;
  quantity?: number;
  unitPriceCents?: number;
  taxCodeId?: string | null;
  costCentreId?: string | null;
}): Promise<CommercialPurchaseOrderLine | null> {
  const purchaseOrder = await getPurchaseOrder(params.organisationId, params.purchaseOrderId);
  if (!purchaseOrder) return null;
  assertPurchaseOrderEditable(purchaseOrder.status);

  const existingRows = (await sql`
    SELECT * FROM commercial_purchase_order_lines
    WHERE id = ${params.lineId} AND purchase_order_id = ${params.purchaseOrderId} AND organisation_id = ${params.organisationId}
  `) as CommercialPurchaseOrderLine[];
  const existing = existingRows[0];
  if (!existing) return null;

  const quantity = params.quantity ?? existing.quantity;
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('quantity must be a positive integer');

  const unitPriceCents = params.unitPriceCents ?? existing.unit_price_cents;
  if (!isValidCents(unitPriceCents)) throw new Error('unitPriceCents must be a non-negative integer');

  if (params.costCentreId) {
    const rows = await sql`SELECT id FROM commercial_cost_centres WHERE id = ${params.costCentreId} AND organisation_id = ${params.organisationId}`;
    if (rows.length === 0) throw new Error('cost_centre_id not found for this organisation');
  }

  let taxCodeSnapshot = existing.tax_code_snapshot;
  let taxRateSnapshot = Number(existing.tax_rate_snapshot);
  if (params.taxCodeId !== undefined) {
    if (params.taxCodeId) {
      const taxCode = await getTaxCode(params.organisationId, params.taxCodeId);
      if (!taxCode) throw new Error('tax_code_id not found for this organisation');
      taxCodeSnapshot = taxCode.code;
      taxRateSnapshot = Number(taxCode.rate);
    } else {
      taxCodeSnapshot = null;
      taxRateSnapshot = 0;
    }
  }

  const { line_subtotal_cents, line_tax_cents, line_total_cents } = computeLineTotals(unitPriceCents, quantity, taxRateSnapshot);

  const rows = (await sql`
    UPDATE commercial_purchase_order_lines SET
      description_snapshot = COALESCE(${params.description ?? null}, description_snapshot),
      quantity = ${quantity},
      unit_price_cents = ${unitPriceCents},
      tax_code_snapshot = ${taxCodeSnapshot},
      tax_rate_snapshot = ${taxRateSnapshot},
      cost_centre_id = COALESCE(${params.costCentreId ?? null}, cost_centre_id),
      line_subtotal_cents = ${line_subtotal_cents},
      line_tax_cents = ${line_tax_cents},
      line_total_cents = ${line_total_cents},
      updated_at = now()
    WHERE id = ${params.lineId} AND purchase_order_id = ${params.purchaseOrderId} AND organisation_id = ${params.organisationId}
    RETURNING *
  `) as CommercialPurchaseOrderLine[];

  await recalculatePurchaseOrderTotals(params.organisationId, params.purchaseOrderId);
  return rows[0] ?? null;
}

export async function deletePurchaseOrderLine(params: { organisationId: string; purchaseOrderId: string; lineId: string }): Promise<boolean> {
  const purchaseOrder = await getPurchaseOrder(params.organisationId, params.purchaseOrderId);
  if (!purchaseOrder) return false;
  assertPurchaseOrderEditable(purchaseOrder.status);

  const rows = (await sql`
    DELETE FROM commercial_purchase_order_lines
    WHERE id = ${params.lineId} AND purchase_order_id = ${params.purchaseOrderId} AND organisation_id = ${params.organisationId}
    RETURNING id
  `) as { id: string }[];
  if (rows.length === 0) return false;

  await recalculatePurchaseOrderTotals(params.organisationId, params.purchaseOrderId);
  return true;
}

// ── Lifecycle transitions ────────────────────────────────────────────
//
// Phase C6.2 §F — submit/approve/return are all simple, single-row,
// status-guarded UPDATEs (no atomic number-allocation concern — that
// only happens at issue). A concurrent double-submit/double-approve is
// still race-safe: Postgres's own row-level locking means only ONE of
// two concurrent `UPDATE ... WHERE status = 'X'` statements against the
// same row can ever see status = 'X' and actually apply; the other
// necessarily finds zero matching rows once the first commits, since
// both run inside their own implicit transaction with normal READ
// COMMITTED re-check-on-lock-wait semantics.

// manager+ (createEdit) — the requester's own action, not a
// higher-trust one. Requires at least one line, matching issueInvoice()'s
// own "cannot issue with no lines" precondition shape.
export async function submitPurchaseOrder(params: { organisationId: string; userId: string; purchaseOrderId: string }): Promise<CommercialPurchaseOrder> {
  const bundle = await getPurchaseOrderWithLines(params.organisationId, params.purchaseOrderId);
  if (!bundle) throw new Error('purchase order not found for this organisation');
  const { purchaseOrder, lines } = bundle;
  assertPurchaseOrderTransition(purchaseOrder.status, 'PENDING_APPROVAL');
  if (lines.length === 0) throw new Error('cannot submit a purchase order with no lines');

  const rows = (await sql`
    UPDATE commercial_purchase_orders SET status = 'PENDING_APPROVAL', submitted_by = ${params.userId}, submitted_at = now(), updated_at = now()
    WHERE id = ${params.purchaseOrderId} AND organisation_id = ${params.organisationId} AND status = 'DRAFT'
    RETURNING *
  `) as CommercialPurchaseOrder[];
  const submitted = rows[0];
  if (!submitted) throw new Error('purchase order status changed concurrently; submit aborted');

  await logPurchaseOrderSubmitted({ organisationId: params.organisationId, userId: params.userId, purchaseOrderId: params.purchaseOrderId });
  return submitted;
}

// admin+ (approve). Self-approval is allowed in the C6.2 foundation (see
// the C6 architecture review's Section F — no existing Commercial
// precedent enforces approver-must-differ-from-requester anywhere);
// submitted_by/approved_by are both preserved so a later
// separation-of-duties rule can be added without a schema change.
export async function approvePurchaseOrder(params: { organisationId: string; userId: string; purchaseOrderId: string }): Promise<CommercialPurchaseOrder> {
  const purchaseOrder = await getPurchaseOrder(params.organisationId, params.purchaseOrderId);
  if (!purchaseOrder) throw new Error('purchase order not found for this organisation');
  assertPurchaseOrderTransition(purchaseOrder.status, 'APPROVED');

  const rows = (await sql`
    UPDATE commercial_purchase_orders SET status = 'APPROVED', approved_by = ${params.userId}, approved_at = now(), updated_at = now()
    WHERE id = ${params.purchaseOrderId} AND organisation_id = ${params.organisationId} AND status = 'PENDING_APPROVAL'
    RETURNING *
  `) as CommercialPurchaseOrder[];
  const approved = rows[0];
  if (!approved) throw new Error('purchase order status changed concurrently; approve aborted (cannot approve twice, or approval already applied by a concurrent request)');

  await logPurchaseOrderApproved({ organisationId: params.organisationId, userId: params.userId, purchaseOrderId: params.purchaseOrderId });
  return approved;
}

// admin+ (approve floor) — returning a PENDING_APPROVAL PO for changes
// requires a non-empty reason, mirroring voidInvoice()'s/
// reverseInvoicePayment()'s identical "trimmed non-empty required
// reason" rule.
export async function returnPurchaseOrderToDraft(params: { organisationId: string; userId: string; purchaseOrderId: string; reason: string }): Promise<CommercialPurchaseOrder> {
  const trimmedReason = params.reason.trim();
  if (!trimmedReason) throw new Error('return reason is required');

  const purchaseOrder = await getPurchaseOrder(params.organisationId, params.purchaseOrderId);
  if (!purchaseOrder) throw new Error('purchase order not found for this organisation');
  assertPurchaseOrderTransition(purchaseOrder.status, 'DRAFT');

  const rows = (await sql`
    UPDATE commercial_purchase_orders SET status = 'DRAFT', return_reason = ${trimmedReason}, updated_at = now()
    WHERE id = ${params.purchaseOrderId} AND organisation_id = ${params.organisationId} AND status = 'PENDING_APPROVAL'
    RETURNING *
  `) as CommercialPurchaseOrder[];
  const returned = rows[0];
  if (!returned) throw new Error('purchase order status changed concurrently; return aborted');

  await logPurchaseOrderReturned({ organisationId: params.organisationId, userId: params.userId, purchaseOrderId: params.purchaseOrderId, returnReason: trimmedReason });
  return returned;
}

// Phase C6.2 §G — mirrors lib/commercial/invoices.ts's
// issueInvoiceAtomically() exactly: "prove the PO is still APPROVED",
// "allocate exactly one PURCHASE_ORDER number", and "transition to
// ISSUED" are ONE compound SQL statement — a single network round-trip
// Postgres executes as one atomic unit. `guard` takes a
// `SELECT ... FOR UPDATE` row-level lock on the purchase-order row;
// under READ COMMITTED semantics, a second concurrent issue attempt on
// the SAME row blocks until the first commits, then re-reads the
// now-current (ISSUED) status, so its own `guard` returns zero rows and
// `seq`'s UPDATE — gated by `EXISTS (SELECT 1 FROM guard)` — never
// touches commercial_document_sequences at all. Exactly one number is
// consumed per successful transition, by construction of a single
// atomic statement, not by convention.
async function issuePurchaseOrderAtomically(params: {
  organisationId: string;
  purchaseOrderId: string;
  userId: string;
  supplier: CommercialSupplierSnapshotSource;
}): Promise<CommercialPurchaseOrder | null> {
  // Unconditional, idempotent, and harmless regardless of the target
  // purchase order's status — this only guarantees a counter row exists
  // to increment; it can never itself consume or leak a number.
  await sql`
    INSERT INTO commercial_document_sequences (organisation_id, document_type, prefix, next_number, padding)
    VALUES (${params.organisationId}, 'PURCHASE_ORDER', 'PO-', 1, 6)
    ON CONFLICT (organisation_id, document_type) DO NOTHING
  `;

  const rows = (await sql`
    WITH guard AS (
      SELECT id FROM commercial_purchase_orders
      WHERE id = ${params.purchaseOrderId} AND organisation_id = ${params.organisationId} AND status = 'APPROVED'
      FOR UPDATE
    ),
    seq AS (
      UPDATE commercial_document_sequences
      SET next_number = next_number + 1, updated_at = now()
      WHERE organisation_id = ${params.organisationId} AND document_type = 'PURCHASE_ORDER'
        AND EXISTS (SELECT 1 FROM guard)
      RETURNING (next_number - 1) AS allocated_number, prefix, padding
    )
    UPDATE commercial_purchase_orders SET
      status = 'ISSUED',
      purchase_order_number = (SELECT prefix || lpad(allocated_number::text, padding, '0') FROM seq),
      issued_by = ${params.userId},
      issued_at = now(),
      supplier_name_snapshot = ${params.supplier.name},
      supplier_legal_name_snapshot = ${params.supplier.legal_name},
      supplier_contact_name_snapshot = ${params.supplier.contact_name},
      supplier_email_snapshot = ${params.supplier.email},
      supplier_phone_snapshot = ${params.supplier.phone},
      supplier_address_snapshot = ${params.supplier.billing_address},
      supplier_tax_business_number_snapshot = ${params.supplier.tax_business_number},
      supplier_reference_snapshot = ${params.supplier.supplier_reference},
      payment_terms_days_snapshot = ${params.supplier.payment_terms_days},
      updated_at = now()
    WHERE id = ${params.purchaseOrderId} AND organisation_id = ${params.organisationId} AND status = 'APPROVED'
      AND EXISTS (SELECT 1 FROM seq)
    RETURNING *
  `) as CommercialPurchaseOrder[];

  return rows[0] ?? null;
}

interface CommercialSupplierSnapshotSource {
  name: string;
  legal_name: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  billing_address: string | null;
  tax_business_number: string | null;
  supplier_reference: string | null;
  payment_terms_days: number | null;
}

// admin+ (approve floor) — issue requires: at least one line, and a
// same-org supplier that still exists. The lifecycle/precondition checks
// below run BEFORE the atomic statement — a request that fails one of
// these never reaches numbering at all.
export async function issuePurchaseOrder(params: { organisationId: string; userId: string; purchaseOrderId: string }): Promise<CommercialPurchaseOrder> {
  const bundle = await getPurchaseOrderWithLines(params.organisationId, params.purchaseOrderId);
  if (!bundle) throw new Error('purchase order not found for this organisation');
  const { purchaseOrder, lines } = bundle;
  assertPurchaseOrderTransition(purchaseOrder.status, 'ISSUED');

  if (lines.length === 0) throw new Error('cannot issue a purchase order with no lines');

  const supplier = await getSupplier(params.organisationId, purchaseOrder.supplier_id);
  if (!supplier) throw new Error('supplier not found for this organisation');

  await recalculatePurchaseOrderTotals(params.organisationId, params.purchaseOrderId);

  const issued = await issuePurchaseOrderAtomically({
    organisationId: params.organisationId,
    purchaseOrderId: params.purchaseOrderId,
    userId: params.userId,
    supplier,
  });
  if (!issued) throw new Error('purchase order status changed concurrently; issue aborted (the atomic guard prevented any number from being consumed)');

  await logPurchaseOrderIssued({
    organisationId: params.organisationId, userId: params.userId, purchaseOrderId: params.purchaseOrderId,
    purchaseOrderNumber: issued.purchase_order_number!, totalCents: issued.total_cents,
  });

  return issued;
}

// admin+ (approve floor) — only an ISSUED purchase order may be
// cancelled; a non-empty, trimmed cancel_reason is mandatory. Retains
// purchase_order_number, totals, lines, and every snapshot field
// untouched — CANCELLED never deletes or renumbers anything, matching
// voidInvoice()'s "immutable issued financial document" principle
// exactly. No receiving/payment concurrency guard is needed here (unlike
// voidInvoice()'s active_paid check) — no receiving or payment subsystem
// exists for Purchasing in C6.2, so a plain status-guarded UPDATE is
// sufficient; Postgres's own row-level locking still makes two
// concurrent cancel attempts on the same PO safe (only one can ever see
// status = 'ISSUED' and apply).
export async function cancelPurchaseOrder(params: { organisationId: string; userId: string; purchaseOrderId: string; reason: string }): Promise<CommercialPurchaseOrder> {
  const trimmedReason = params.reason.trim();
  if (!trimmedReason) throw new Error('cancel_reason is required');

  const purchaseOrder = await getPurchaseOrder(params.organisationId, params.purchaseOrderId);
  if (!purchaseOrder) throw new Error('purchase order not found for this organisation');
  assertPurchaseOrderTransition(purchaseOrder.status, 'CANCELLED');

  const rows = (await sql`
    UPDATE commercial_purchase_orders SET status = 'CANCELLED', cancelled_by = ${params.userId}, cancelled_at = now(), cancel_reason = ${trimmedReason}, updated_at = now()
    WHERE id = ${params.purchaseOrderId} AND organisation_id = ${params.organisationId} AND status = 'ISSUED'
    RETURNING *
  `) as CommercialPurchaseOrder[];
  const cancelled = rows[0];
  if (!cancelled) throw new Error('purchase order status changed concurrently; cancel aborted');

  await logPurchaseOrderCancelled({ organisationId: params.organisationId, userId: params.userId, purchaseOrderId: params.purchaseOrderId, cancelReason: trimmedReason });
  return cancelled;
}
