import 'server-only';

import sql from '@/lib/db';
import { isValidCents } from './money';
import { PAYMENT_METHODS, type PaymentMethod } from './paymentMethods';
import { logSupplierPaymentRecorded, logSupplierPaymentReversed } from './auditLog';

export { PAYMENT_METHODS, type PaymentMethod };

export type SupplierPaymentStatus = 'RECORDED' | 'REVERSED';
export type SupplierBillPaymentState = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';

export interface CommercialSupplierPayment {
  id: string;
  organisation_id: string;
  supplier_id: string;
  amount_cents: number;
  currency: string;
  method: PaymentMethod;
  reference: string | null;
  provider: string | null;
  provider_reference: string | null;
  paid_at: string;
  status: SupplierPaymentStatus;
  recorded_by: string | null;
  reversed_at: string | null;
  reversed_by: string | null;
  reversal_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommercialSupplierPaymentAllocation {
  id: string;
  organisation_id: string;
  supplier_payment_id: string;
  supplier_bill_id: string;
  supplier_id: string;
  currency: string;
  allocated_amount_cents: number;
  created_at: string;
}

export interface SupplierPaymentAllocationInput {
  supplierBillId: string;
  amountCents: number;
}

export interface SupplierBillPaymentHistoryItem extends CommercialSupplierPayment {
  allocated_amount_cents: number;
}

export interface SupplierBillPaymentSummary {
  supplier_bill_id: string;
  total_cents: number;
  amount_paid_cents: number;
  outstanding_balance_cents: number;
  payment_state: SupplierBillPaymentState;
  active_payment_count: number;
  payments: SupplierBillPaymentHistoryItem[];
}

function isValidPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value);
}

function normalizeCurrency(value: string): string {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('currency must be a 3-letter code');
  return currency;
}

function derivePaymentState(paidCents: number, totalCents: number): SupplierBillPaymentState {
  if (paidCents <= 0) return 'UNPAID';
  if (paidCents >= totalCents) return 'PAID';
  return 'PARTIALLY_PAID';
}

function validateAllocations(amountCents: number, allocations: SupplierPaymentAllocationInput[]) {
  if (!isValidCents(amountCents) || amountCents <= 0) {
    throw new Error('amount_cents must be a positive integer');
  }
  if (allocations.length === 0) throw new Error('at least one supplier bill allocation is required');

  const ids = new Set<string>();
  let sum = 0;
  for (const allocation of allocations) {
    if (!allocation.supplierBillId) throw new Error('supplier_bill_id is required');
    if (ids.has(allocation.supplierBillId)) {
      throw new Error('a supplier bill may appear only once in one supplier payment');
    }
    ids.add(allocation.supplierBillId);
    if (!isValidCents(allocation.amountCents) || allocation.amountCents <= 0) {
      throw new Error('allocated_amount_cents must be a positive integer');
    }
    sum += allocation.amountCents;
    if (!Number.isSafeInteger(sum)) throw new Error('supplier payment allocation total is outside the safe integer range');
  }
  if (sum !== amountCents) {
    throw new Error('supplier payment allocations must equal amount_cents');
  }
}

export async function getSupplierBillPaymentSummary(
  organisationId: string,
  supplierBillId: string,
): Promise<SupplierBillPaymentSummary | null> {
  const rows = (await sql`
    SELECT
      sb.id AS supplier_bill_id,
      sb.total_cents,
      COALESCE(SUM(spa.allocated_amount_cents) FILTER (WHERE sp.status = 'RECORDED'), 0)::int AS paid_cents,
      COUNT(DISTINCT sp.id) FILTER (WHERE sp.status = 'RECORDED')::int AS active_payment_count
    FROM commercial_supplier_bills sb
    LEFT JOIN commercial_supplier_payment_allocations spa
      ON spa.supplier_bill_id = sb.id
     AND spa.organisation_id = sb.organisation_id
    LEFT JOIN commercial_supplier_payments sp
      ON sp.id = spa.supplier_payment_id
     AND sp.organisation_id = spa.organisation_id
    WHERE sb.id = ${supplierBillId}
      AND sb.organisation_id = ${organisationId}
    GROUP BY sb.id, sb.total_cents
  `) as {
    supplier_bill_id: string;
    total_cents: number;
    paid_cents: number;
    active_payment_count: number;
  }[];

  const row = rows[0];
  if (!row) return null;

  const payments = (await sql`
    SELECT sp.*, spa.allocated_amount_cents
    FROM commercial_supplier_payment_allocations spa
    JOIN commercial_supplier_payments sp
      ON sp.id = spa.supplier_payment_id
     AND sp.organisation_id = spa.organisation_id
    WHERE spa.organisation_id = ${organisationId}
      AND spa.supplier_bill_id = ${supplierBillId}
    ORDER BY sp.paid_at DESC, sp.created_at DESC, sp.id DESC
  `) as SupplierBillPaymentHistoryItem[];

  const paid = row.paid_cents ?? 0;
  return {
    supplier_bill_id: row.supplier_bill_id,
    total_cents: row.total_cents,
    amount_paid_cents: paid,
    outstanding_balance_cents: Math.max(0, row.total_cents - paid),
    payment_state: derivePaymentState(paid, row.total_cents),
    active_payment_count: row.active_payment_count ?? 0,
    payments,
  };
}

export async function listSupplierPaymentAllocations(
  organisationId: string,
  supplierPaymentId: string,
): Promise<CommercialSupplierPaymentAllocation[]> {
  return (await sql`
    SELECT *
    FROM commercial_supplier_payment_allocations
    WHERE organisation_id = ${organisationId}
      AND supplier_payment_id = ${supplierPaymentId}
    ORDER BY created_at ASC, id ASC
  `) as CommercialSupplierPaymentAllocation[];
}

export async function recordSupplierPayment(params: {
  organisationId: string;
  userId: string;
  supplierId: string;
  amountCents: number;
  currency: string;
  method: PaymentMethod;
  allocations: SupplierPaymentAllocationInput[];
  reference?: string | null;
  provider?: string | null;
  providerReference?: string | null;
  paidAt?: string | null;
}): Promise<{
  payment: CommercialSupplierPayment;
  allocations: CommercialSupplierPaymentAllocation[];
}> {
  validateAllocations(params.amountCents, params.allocations);
  if (!isValidPaymentMethod(params.method)) throw new Error('Invalid payment method');
  if (!params.supplierId) throw new Error('supplier_id is required');
  if (params.providerReference && !params.provider?.trim()) {
    throw new Error('provider is required when provider_reference is set');
  }

  const currency = normalizeCurrency(params.currency);
  if (params.paidAt && Number.isNaN(Date.parse(params.paidAt))) {
    throw new Error('paid_at must be a valid date/time');
  }

  const requested = params.allocations.map(allocation => ({
    supplier_bill_id: allocation.supplierBillId,
    allocated_amount_cents: allocation.amountCents,
  }));
  const requestedJson = JSON.stringify(requested);

  const [, paymentRows] = await sql.transaction(txn => [
    txn`
      WITH requested AS MATERIALIZED (
        SELECT *
        FROM jsonb_to_recordset(${requestedJson}::jsonb)
          AS x(supplier_bill_id uuid, allocated_amount_cents integer)
      )
      SELECT sb.id
      FROM commercial_supplier_bills sb
      JOIN requested r ON r.supplier_bill_id = sb.id
      WHERE sb.organisation_id = ${params.organisationId}
      ORDER BY sb.id
      FOR UPDATE
    `,
    txn`
      WITH requested AS MATERIALIZED (
        SELECT *
        FROM jsonb_to_recordset(${requestedJson}::jsonb)
          AS x(supplier_bill_id uuid, allocated_amount_cents integer)
      ),
      bills AS MATERIALIZED (
        SELECT
          sb.id,
          sb.status,
          sb.supplier_id,
          sb.currency,
          sb.total_cents,
          r.allocated_amount_cents
        FROM commercial_supplier_bills sb
        JOIN requested r ON r.supplier_bill_id = sb.id
        WHERE sb.organisation_id = ${params.organisationId}
      ),
      active_paid AS MATERIALIZED (
        SELECT
          b.id AS supplier_bill_id,
          COALESCE(SUM(spa.allocated_amount_cents) FILTER (WHERE sp.status = 'RECORDED'), 0)::int AS paid_cents
        FROM bills b
        LEFT JOIN commercial_supplier_payment_allocations spa
          ON spa.supplier_bill_id = b.id
         AND spa.organisation_id = ${params.organisationId}
        LEFT JOIN commercial_supplier_payments sp
          ON sp.id = spa.supplier_payment_id
         AND sp.organisation_id = spa.organisation_id
        GROUP BY b.id
      ),
      checks AS MATERIALIZED (
        SELECT
          COUNT(*)::int AS bill_count,
          COALESCE(SUM(b.allocated_amount_cents), 0)::int AS allocation_total,
          COALESCE(bool_and(
            b.status = 'POSTED'
            AND b.supplier_id = ${params.supplierId}::uuid
            AND b.currency = ${currency}
            AND b.allocated_amount_cents <= (b.total_cents - ap.paid_cents)
          ), false) AS all_valid
        FROM bills b
        JOIN active_paid ap ON ap.supplier_bill_id = b.id
      ),
      ins_payment AS (
        INSERT INTO commercial_supplier_payments (
          organisation_id, supplier_id, amount_cents, currency, method,
          reference, provider, provider_reference, paid_at, recorded_by
        )
        SELECT
          ${params.organisationId},
          ${params.supplierId}::uuid,
          ${params.amountCents},
          ${currency},
          ${params.method},
          ${params.reference ?? null},
          ${params.provider?.trim() || null},
          ${params.providerReference ?? null},
          COALESCE(${params.paidAt ?? null}::timestamptz, now()),
          ${params.userId}
        FROM checks
        WHERE bill_count = ${requested.length}
          AND allocation_total = ${params.amountCents}
          AND all_valid = true
        RETURNING *
      ),
      ins_allocations AS (
        INSERT INTO commercial_supplier_payment_allocations (
          organisation_id, supplier_payment_id, supplier_bill_id,
          supplier_id, currency, allocated_amount_cents
        )
        SELECT
          ${params.organisationId},
          p.id,
          r.supplier_bill_id,
          ${params.supplierId}::uuid,
          ${currency},
          r.allocated_amount_cents
        FROM requested r
        CROSS JOIN ins_payment p
        RETURNING *
      )
      SELECT p.*, (SELECT COUNT(*)::int FROM ins_allocations) AS allocation_count
      FROM ins_payment p
    `,
  ], { isolationLevel: 'ReadCommitted' });

  const row = (paymentRows as (CommercialSupplierPayment & { allocation_count: number })[])[0];
  if (!row || row.allocation_count !== requested.length) {
    throw new Error('supplier payment could not be recorded; verify every bill is POSTED, belongs to this supplier/currency, and has enough remaining balance');
  }

  const payment: CommercialSupplierPayment = {
    id: row.id,
    organisation_id: row.organisation_id,
    supplier_id: row.supplier_id,
    amount_cents: row.amount_cents,
    currency: row.currency,
    method: row.method,
    reference: row.reference,
    provider: row.provider,
    provider_reference: row.provider_reference,
    paid_at: row.paid_at,
    status: row.status,
    recorded_by: row.recorded_by,
    reversed_at: row.reversed_at,
    reversed_by: row.reversed_by,
    reversal_reason: row.reversal_reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };

  const allocations = await listSupplierPaymentAllocations(params.organisationId, payment.id);
  await logSupplierPaymentRecorded({
    organisationId: params.organisationId,
    userId: params.userId,
    supplierPaymentId: payment.id,
    supplierId: payment.supplier_id,
    amountCents: payment.amount_cents,
    currency: payment.currency,
    method: payment.method,
    paidAt: payment.paid_at,
    billAllocations: allocations.map(allocation => ({
      supplier_bill_id: allocation.supplier_bill_id,
      allocated_amount_cents: allocation.allocated_amount_cents,
    })),
  });

  return { payment, allocations };
}

export async function reverseSupplierPayment(params: {
  organisationId: string;
  userId: string;
  supplierPaymentId: string;
  reason: string;
}): Promise<CommercialSupplierPayment> {
  const reason = params.reason.trim();
  if (!reason) throw new Error('reversal_reason is required');

  const rows = (await sql`
    UPDATE commercial_supplier_payments
    SET
      status = 'REVERSED',
      reversed_at = now(),
      reversed_by = ${params.userId},
      reversal_reason = ${reason},
      updated_at = now()
    WHERE id = ${params.supplierPaymentId}
      AND organisation_id = ${params.organisationId}
      AND status = 'RECORDED'
    RETURNING *
  `) as CommercialSupplierPayment[];

  const reversed = rows[0];
  if (!reversed) throw new Error('supplier payment already reversed, or changed concurrently');

  const allocations = await listSupplierPaymentAllocations(params.organisationId, reversed.id);
  await logSupplierPaymentReversed({
    organisationId: params.organisationId,
    userId: params.userId,
    supplierPaymentId: reversed.id,
    amountCents: reversed.amount_cents,
    reversalReason: reason,
    reversedAt: reversed.reversed_at!,
    supplierBillIds: allocations.map(allocation => allocation.supplier_bill_id),
  });

  return reversed;
}
