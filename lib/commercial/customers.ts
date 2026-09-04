import sql from '@/lib/db';
import { logCustomerCreated, logCustomerUpdated, logCustomerDeactivated } from './auditLog';

// Phase C2 — tenant-scoped data access for commercial_customers (the
// Commercial Core's customer/counterparty anchor — see
// scripts/create-commercial-core.sql's own header comment for why this
// is a dedicated table, not organisations.id, crm_companies, or
// crm_contacts directly). Every function here takes organisationId as
// its own explicit parameter — the caller (a future route, already
// gated by authorizeCommercialRequest()) is responsible for supplying an
// already-trusted value; this module never resolves it itself, matching
// lib/capabilities/requireCapability.ts's own established discipline.
//
// Every query is scoped by `organisation_id = ${organisationId}` —
// there is no function anywhere in this file that can read or write a
// row without that predicate, which is what makes cross-organisation
// access structurally impossible from this module's own surface, not
// merely a convention a caller could forget to apply.

export interface CommercialCustomer {
  id: string;
  organisation_id: string;
  name: string;
  crm_company_id: string | null;
  crm_contact_id: string | null;
  billing_email: string | null;
  billing_phone: string | null;
  billing_address: string | null;
  tax_business_number: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export async function listCustomers(organisationId: string, opts: { activeOnly?: boolean } = {}): Promise<CommercialCustomer[]> {
  if (opts.activeOnly) {
    return (await sql`
      SELECT * FROM commercial_customers
      WHERE organisation_id = ${organisationId} AND active = true
      ORDER BY name ASC
    `) as CommercialCustomer[];
  }
  return (await sql`
    SELECT * FROM commercial_customers
    WHERE organisation_id = ${organisationId}
    ORDER BY name ASC
  `) as CommercialCustomer[];
}

// Returns null both for "does not exist" and "exists but belongs to a
// different organisation" — deliberately indistinguishable to the
// caller, matching this codebase's established tenant-isolation
// discipline (e.g. app/api/pipeline/[id]/messages/route.ts's identical
// ownership-check-returns-404-either-way pattern) — a caller must never
// be able to distinguish "not found" from "not yours" by response shape.
export async function getCustomer(organisationId: string, customerId: string): Promise<CommercialCustomer | null> {
  const rows = (await sql`
    SELECT * FROM commercial_customers
    WHERE id = ${customerId} AND organisation_id = ${organisationId}
  `) as CommercialCustomer[];
  return rows[0] ?? null;
}

export async function createCustomer(params: {
  organisationId: string;
  userId: string;
  name: string;
  crmCompanyId?: string | null;
  crmContactId?: string | null;
  billingEmail?: string | null;
  billingPhone?: string | null;
  billingAddress?: string | null;
  taxBusinessNumber?: string | null;
}): Promise<CommercialCustomer> {
  const rows = (await sql`
    INSERT INTO commercial_customers (
      organisation_id, name, crm_company_id, crm_contact_id,
      billing_email, billing_phone, billing_address, tax_business_number, created_by
    ) VALUES (
      ${params.organisationId}, ${params.name}, ${params.crmCompanyId ?? null}, ${params.crmContactId ?? null},
      ${params.billingEmail ?? null}, ${params.billingPhone ?? null}, ${params.billingAddress ?? null},
      ${params.taxBusinessNumber ?? null}, ${params.userId}
    )
    RETURNING *
  `) as CommercialCustomer[];
  const customer = rows[0];

  await logCustomerCreated({
    organisationId: params.organisationId, userId: params.userId, customerId: customer.id,
    after: { name: customer.name },
  });

  return customer;
}

export async function updateCustomer(params: {
  organisationId: string;
  userId: string;
  customerId: string;
  name?: string;
  billingEmail?: string | null;
  billingPhone?: string | null;
  billingAddress?: string | null;
  taxBusinessNumber?: string | null;
}): Promise<CommercialCustomer | null> {
  const before = await getCustomer(params.organisationId, params.customerId);
  if (!before) return null;

  const rows = (await sql`
    UPDATE commercial_customers SET
      name = COALESCE(${params.name ?? null}, name),
      billing_email = COALESCE(${params.billingEmail}, billing_email),
      billing_phone = COALESCE(${params.billingPhone}, billing_phone),
      billing_address = COALESCE(${params.billingAddress}, billing_address),
      tax_business_number = COALESCE(${params.taxBusinessNumber}, tax_business_number),
      updated_at = now()
    WHERE id = ${params.customerId} AND organisation_id = ${params.organisationId}
    RETURNING *
  `) as CommercialCustomer[];
  const after = rows[0];

  await logCustomerUpdated({
    organisationId: params.organisationId, userId: params.userId, customerId: params.customerId,
    before: { name: before.name, billing_email: before.billing_email },
    after: { name: after.name, billing_email: after.billing_email },
  });

  return after;
}

export async function deactivateCustomer(params: { organisationId: string; userId: string; customerId: string }): Promise<boolean> {
  const rows = (await sql`
    UPDATE commercial_customers SET active = false, updated_at = now()
    WHERE id = ${params.customerId} AND organisation_id = ${params.organisationId} AND active = true
    RETURNING id
  `) as { id: string }[];
  if (rows.length === 0) return false;

  await logCustomerDeactivated({ organisationId: params.organisationId, userId: params.userId, customerId: params.customerId });
  return true;
}
