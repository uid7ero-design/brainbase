import sql from '@/lib/db';
import { isValidCents, isValidCurrencyCode } from './money';
import { logProductCreated, logProductUpdated, logProductDeactivated, logProductReactivated } from './auditLog';

// Phase C2 — tenant-scoped data access for commercial_products (the
// product/service catalogue). Every function scoped by organisation_id,
// same discipline as lib/commercial/customers.ts.

export type CommercialProductType = 'PRODUCT' | 'SERVICE';

export interface CommercialProduct {
  id: string;
  organisation_id: string;
  type: CommercialProductType;
  name: string;
  description: string | null;
  sku: string | null;
  active: boolean;
  unit_label: string | null;
  default_unit_price_cents: number;
  currency: string;
  default_tax_code_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function listProducts(organisationId: string, opts: { activeOnly?: boolean } = {}): Promise<CommercialProduct[]> {
  if (opts.activeOnly) {
    return (await sql`
      SELECT * FROM commercial_products WHERE organisation_id = ${organisationId} AND active = true ORDER BY name ASC
    `) as CommercialProduct[];
  }
  return (await sql`
    SELECT * FROM commercial_products WHERE organisation_id = ${organisationId} ORDER BY name ASC
  `) as CommercialProduct[];
}

export async function getProduct(organisationId: string, productId: string): Promise<CommercialProduct | null> {
  const rows = (await sql`
    SELECT * FROM commercial_products WHERE id = ${productId} AND organisation_id = ${organisationId}
  `) as CommercialProduct[];
  return rows[0] ?? null;
}

// Throws a plain Error (never a partially-constructed row) if the
// money/currency shape is invalid — ADR-0002 compliance is enforced at
// this boundary, not left to the database's own CHECK constraint alone
// (which only rejects a negative price, not a non-ISO-shaped currency
// code or a non-integer value passed from a loosely-typed caller).
export async function createProduct(params: {
  organisationId: string;
  userId: string;
  type: CommercialProductType;
  name: string;
  description?: string | null;
  sku?: string | null;
  unitLabel?: string | null;
  defaultUnitPriceCents: number;
  currency: string;
  defaultTaxCodeId?: string | null;
}): Promise<CommercialProduct> {
  if (!isValidCents(params.defaultUnitPriceCents)) {
    throw new Error('defaultUnitPriceCents must be a non-negative integer');
  }
  if (!isValidCurrencyCode(params.currency)) {
    throw new Error('currency must be a 3-letter ISO 4217 code');
  }

  const rows = (await sql`
    INSERT INTO commercial_products (
      organisation_id, type, name, description, sku, unit_label,
      default_unit_price_cents, currency, default_tax_code_id, created_by
    ) VALUES (
      ${params.organisationId}, ${params.type}, ${params.name}, ${params.description ?? null}, ${params.sku ?? null},
      ${params.unitLabel ?? null}, ${params.defaultUnitPriceCents}, ${params.currency}, ${params.defaultTaxCodeId ?? null}, ${params.userId}
    )
    RETURNING *
  `) as CommercialProduct[];
  const product = rows[0];

  await logProductCreated({
    organisationId: params.organisationId, userId: params.userId, productId: product.id,
    after: { name: product.name, type: product.type, default_unit_price_cents: product.default_unit_price_cents, currency: product.currency },
  });

  return product;
}

export async function updateProduct(params: {
  organisationId: string;
  userId: string;
  productId: string;
  name?: string;
  description?: string | null;
  defaultUnitPriceCents?: number;
  defaultTaxCodeId?: string | null;
}): Promise<CommercialProduct | null> {
  if (params.defaultUnitPriceCents !== undefined && !isValidCents(params.defaultUnitPriceCents)) {
    throw new Error('defaultUnitPriceCents must be a non-negative integer');
  }

  const before = await getProduct(params.organisationId, params.productId);
  if (!before) return null;

  const rows = (await sql`
    UPDATE commercial_products SET
      name = COALESCE(${params.name ?? null}, name),
      description = COALESCE(${params.description}, description),
      default_unit_price_cents = COALESCE(${params.defaultUnitPriceCents ?? null}, default_unit_price_cents),
      default_tax_code_id = COALESCE(${params.defaultTaxCodeId}, default_tax_code_id),
      updated_at = now()
    WHERE id = ${params.productId} AND organisation_id = ${params.organisationId}
    RETURNING *
  `) as CommercialProduct[];
  const after = rows[0];

  await logProductUpdated({
    organisationId: params.organisationId, userId: params.userId, productId: params.productId,
    before: { name: before.name, default_unit_price_cents: before.default_unit_price_cents },
    after: { name: after.name, default_unit_price_cents: after.default_unit_price_cents },
  });

  return after;
}

export async function deactivateProduct(params: { organisationId: string; userId: string; productId: string }): Promise<boolean> {
  const rows = (await sql`
    UPDATE commercial_products SET active = false, updated_at = now()
    WHERE id = ${params.productId} AND organisation_id = ${params.organisationId} AND active = true
    RETURNING id
  `) as { id: string }[];
  if (rows.length === 0) return false;

  await logProductDeactivated({ organisationId: params.organisationId, userId: params.userId, productId: params.productId });
  return true;
}

// Phase C3 — symmetric counterpart to deactivateProduct(), same
// rationale as customers.ts's reactivateCustomer().
export async function reactivateProduct(params: { organisationId: string; userId: string; productId: string }): Promise<boolean> {
  const rows = (await sql`
    UPDATE commercial_products SET active = true, updated_at = now()
    WHERE id = ${params.productId} AND organisation_id = ${params.organisationId} AND active = false
    RETURNING id
  `) as { id: string }[];
  if (rows.length === 0) return false;

  await logProductReactivated({ organisationId: params.organisationId, userId: params.userId, productId: params.productId });
  return true;
}
