import sql from '@/lib/db';
import { isValidRatePercent } from './money';

// Phase C2 — tenant-scoped data access for commercial_tax_codes.
// No audit wiring: ADR-0003 §2 requires an audit entry for a mutation
// that "changes a commercial document's status", is "money-moving", is
// an "approval/rejection decision", or produces a "commercial export" —
// creating/editing a tenant's own tax-rate configuration is none of
// those (it is closer to org settings than a document/transaction
// event); no other configuration table in this codebase (e.g.
// scripts/seed-modules-registry.sql's own module registration) is
// audit-logged either. Revisit if a future phase finds evidence this
// specific configuration change needs its own audit trail.

export interface CommercialTaxCode {
  id: string;
  organisation_id: string;
  code: string;
  name: string;
  rate: string; // NUMERIC(5,2) — returned as a string by the Postgres driver, never coerced to float here
  is_default: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export async function listTaxCodes(organisationId: string, opts: { activeOnly?: boolean } = {}): Promise<CommercialTaxCode[]> {
  if (opts.activeOnly) {
    return (await sql`
      SELECT * FROM commercial_tax_codes WHERE organisation_id = ${organisationId} AND active = true ORDER BY code ASC
    `) as CommercialTaxCode[];
  }
  return (await sql`
    SELECT * FROM commercial_tax_codes WHERE organisation_id = ${organisationId} ORDER BY code ASC
  `) as CommercialTaxCode[];
}

// Phase C3 — needed by lib/commercial/quotes.ts's addQuoteLine() to
// resolve an explicitly-chosen tax code (or a product's
// default_tax_code_id) into its current code/rate at the moment a line
// is created. Same tenant-scoping discipline as every other lookup here.
export async function getTaxCode(organisationId: string, taxCodeId: string): Promise<CommercialTaxCode | null> {
  const rows = (await sql`
    SELECT * FROM commercial_tax_codes WHERE id = ${taxCodeId} AND organisation_id = ${organisationId}
  `) as CommercialTaxCode[];
  return rows[0] ?? null;
}

export async function getDefaultTaxCode(organisationId: string): Promise<CommercialTaxCode | null> {
  const rows = (await sql`
    SELECT * FROM commercial_tax_codes WHERE organisation_id = ${organisationId} AND is_default = true AND active = true LIMIT 1
  `) as CommercialTaxCode[];
  return rows[0] ?? null;
}

export async function createTaxCode(params: {
  organisationId: string; code: string; name: string; rate: number; isDefault?: boolean;
}): Promise<CommercialTaxCode> {
  if (!isValidRatePercent(params.rate)) {
    throw new Error('rate must be 0.00-100.00 with at most 2 decimal places');
  }

  const rows = (await sql`
    INSERT INTO commercial_tax_codes (organisation_id, code, name, rate, is_default)
    VALUES (${params.organisationId}, ${params.code}, ${params.name}, ${params.rate}, ${params.isDefault ?? false})
    RETURNING *
  `) as CommercialTaxCode[];
  return rows[0];
}

export async function deactivateTaxCode(params: { organisationId: string; taxCodeId: string }): Promise<boolean> {
  const rows = (await sql`
    UPDATE commercial_tax_codes SET active = false, updated_at = now()
    WHERE id = ${params.taxCodeId} AND organisation_id = ${params.organisationId} AND active = true
    RETURNING id
  `) as { id: string }[];
  return rows.length > 0;
}
