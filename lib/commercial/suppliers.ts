import 'server-only';
import sql from '@/lib/db';
import { logSupplierCreated, logSupplierUpdated, logSupplierDeactivated, logSupplierReactivated } from './auditLog';

// Phase C6.2 — tenant-scoped data access for commercial_suppliers (the
// Purchasing counterpart of lib/commercial/customers.ts — see
// scripts/create-commercial-purchasing.sql's own header comment for why
// this is a dedicated table, not commercial_customers, crm_companies, or
// crm_contacts directly). Every function here takes organisationId as
// its own explicit parameter — the caller (a future route, already
// gated by authorizeCommercialRequest()) is responsible for supplying an
// already-trusted value; this module never resolves it itself.
//
// `import 'server-only'` above — this module imports lib/db and must
// never be reachable from a Client Component bundle (see the C5.3B
// Production incident this exact guard was introduced to prevent).
//
// Every query is scoped by `organisation_id = ${organisationId}` —
// there is no function anywhere in this file that can read or write a
// row without that predicate, which is what makes cross-organisation
// access structurally impossible from this module's own surface.
//
// crm_company_id/crm_contact_id are PLAIN foreign keys (no
// organisation_id in the constraint) — mirroring
// lib/commercial/customers.ts's own identical columns for the identical
// reason: crm_companies/crm_contacts carry no UNIQUE(id, organisation_id)
// anchor today. Fail-closed, application-level ownership validation is
// therefore REQUIRED here too, not optional hardening — without it, a
// supplier for organisation A could link to a CRM company/contact
// belonging to organisation B.
async function assertCrmCompanyOwnership(organisationId: string, crmCompanyId: string): Promise<void> {
  const rows = await sql`SELECT id FROM crm_companies WHERE id = ${crmCompanyId} AND organisation_id = ${organisationId}`;
  // Deliberately the SAME error for "doesn't exist" and "exists but
  // belongs to a different organisation" — matching getSupplier()'s own
  // documented reasoning just below: a caller must never be able to
  // learn that a given id exists in SOME other organisation from this
  // error alone.
  if (rows.length === 0) throw new Error('crm_company_id not found for this organisation');
}
async function assertCrmContactOwnership(organisationId: string, crmContactId: string): Promise<void> {
  const rows = await sql`SELECT id FROM crm_contacts WHERE id = ${crmContactId} AND organisation_id = ${organisationId}`;
  if (rows.length === 0) throw new Error('crm_contact_id not found for this organisation');
}

export interface CommercialSupplier {
  id: string;
  organisation_id: string;
  name: string;
  legal_name: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  billing_address: string | null;
  tax_business_number: string | null;
  supplier_reference: string | null;
  payment_terms_days: number | null;
  crm_company_id: string | null;
  crm_contact_id: string | null;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function listSuppliers(organisationId: string, opts: { activeOnly?: boolean } = {}): Promise<CommercialSupplier[]> {
  if (opts.activeOnly) {
    return (await sql`
      SELECT * FROM commercial_suppliers
      WHERE organisation_id = ${organisationId} AND active = true
      ORDER BY name ASC
    `) as CommercialSupplier[];
  }
  return (await sql`
    SELECT * FROM commercial_suppliers
    WHERE organisation_id = ${organisationId}
    ORDER BY name ASC
  `) as CommercialSupplier[];
}

// Returns null both for "does not exist" and "exists but belongs to a
// different organisation" — deliberately indistinguishable to the
// caller, matching lib/commercial/customers.ts's getCustomer()'s
// identical tenant-isolation discipline.
export async function getSupplier(organisationId: string, supplierId: string): Promise<CommercialSupplier | null> {
  const rows = (await sql`
    SELECT * FROM commercial_suppliers
    WHERE id = ${supplierId} AND organisation_id = ${organisationId}
  `) as CommercialSupplier[];
  return rows[0] ?? null;
}

export async function createSupplier(params: {
  organisationId: string;
  userId: string;
  name: string;
  legalName?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  billingAddress?: string | null;
  taxBusinessNumber?: string | null;
  supplierReference?: string | null;
  paymentTermsDays?: number | null;
  crmCompanyId?: string | null;
  crmContactId?: string | null;
  notes?: string | null;
}): Promise<CommercialSupplier> {
  const name = params.name.trim();
  if (!name) throw new Error('name is required');
  if (params.paymentTermsDays != null && (!Number.isInteger(params.paymentTermsDays) || params.paymentTermsDays < 0)) {
    throw new Error('payment_terms_days must be a non-negative integer');
  }
  if (params.crmCompanyId) await assertCrmCompanyOwnership(params.organisationId, params.crmCompanyId);
  if (params.crmContactId) await assertCrmContactOwnership(params.organisationId, params.crmContactId);

  const rows = (await sql`
    INSERT INTO commercial_suppliers (
      organisation_id, name, legal_name, contact_name, email, phone, billing_address,
      tax_business_number, supplier_reference, payment_terms_days, crm_company_id, crm_contact_id, notes, created_by
    ) VALUES (
      ${params.organisationId}, ${name}, ${params.legalName ?? null}, ${params.contactName ?? null},
      ${params.email ?? null}, ${params.phone ?? null}, ${params.billingAddress ?? null},
      ${params.taxBusinessNumber ?? null}, ${params.supplierReference ?? null}, ${params.paymentTermsDays ?? null},
      ${params.crmCompanyId ?? null}, ${params.crmContactId ?? null}, ${params.notes ?? null}, ${params.userId}
    )
    RETURNING *
  `) as CommercialSupplier[];
  const supplier = rows[0];

  await logSupplierCreated({
    organisationId: params.organisationId, userId: params.userId, supplierId: supplier.id,
    after: { name: supplier.name },
  });

  return supplier;
}

export async function updateSupplier(params: {
  organisationId: string;
  userId: string;
  supplierId: string;
  name?: string;
  legalName?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  billingAddress?: string | null;
  taxBusinessNumber?: string | null;
  supplierReference?: string | null;
  paymentTermsDays?: number | null;
  crmCompanyId?: string | null;
  crmContactId?: string | null;
  notes?: string | null;
}): Promise<CommercialSupplier | null> {
  const before = await getSupplier(params.organisationId, params.supplierId);
  if (!before) return null;

  if (params.name !== undefined && !params.name.trim()) throw new Error('name cannot be blank');
  if (params.paymentTermsDays != null && (!Number.isInteger(params.paymentTermsDays) || params.paymentTermsDays < 0)) {
    throw new Error('payment_terms_days must be a non-negative integer');
  }
  if (params.crmCompanyId) await assertCrmCompanyOwnership(params.organisationId, params.crmCompanyId);
  if (params.crmContactId) await assertCrmContactOwnership(params.organisationId, params.crmContactId);

  const rows = (await sql`
    UPDATE commercial_suppliers SET
      name = COALESCE(${params.name?.trim() ?? null}, name),
      legal_name = COALESCE(${params.legalName}, legal_name),
      contact_name = COALESCE(${params.contactName}, contact_name),
      email = COALESCE(${params.email}, email),
      phone = COALESCE(${params.phone}, phone),
      billing_address = COALESCE(${params.billingAddress}, billing_address),
      tax_business_number = COALESCE(${params.taxBusinessNumber}, tax_business_number),
      supplier_reference = COALESCE(${params.supplierReference}, supplier_reference),
      payment_terms_days = COALESCE(${params.paymentTermsDays ?? null}, payment_terms_days),
      crm_company_id = COALESCE(${params.crmCompanyId ?? null}, crm_company_id),
      crm_contact_id = COALESCE(${params.crmContactId ?? null}, crm_contact_id),
      notes = COALESCE(${params.notes}, notes),
      updated_at = now()
    WHERE id = ${params.supplierId} AND organisation_id = ${params.organisationId}
    RETURNING *
  `) as CommercialSupplier[];
  const after = rows[0];

  await logSupplierUpdated({
    organisationId: params.organisationId, userId: params.userId, supplierId: params.supplierId,
    before: { name: before.name, email: before.email }, after: { name: after.name, email: after.email },
  });

  return after;
}

export async function deactivateSupplier(params: { organisationId: string; userId: string; supplierId: string }): Promise<boolean> {
  const rows = (await sql`
    UPDATE commercial_suppliers SET active = false, updated_at = now()
    WHERE id = ${params.supplierId} AND organisation_id = ${params.organisationId} AND active = true
    RETURNING id
  `) as { id: string }[];
  if (rows.length === 0) return false;

  await logSupplierDeactivated({ organisationId: params.organisationId, userId: params.userId, supplierId: params.supplierId });
  return true;
}

export async function reactivateSupplier(params: { organisationId: string; userId: string; supplierId: string }): Promise<boolean> {
  const rows = (await sql`
    UPDATE commercial_suppliers SET active = true, updated_at = now()
    WHERE id = ${params.supplierId} AND organisation_id = ${params.organisationId} AND active = false
    RETURNING id
  `) as { id: string }[];
  if (rows.length === 0) return false;

  await logSupplierReactivated({ organisationId: params.organisationId, userId: params.userId, supplierId: params.supplierId });
  return true;
}
