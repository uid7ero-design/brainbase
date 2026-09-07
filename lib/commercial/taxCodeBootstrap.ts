import sql from '@/lib/db';
import type { CommercialTaxCode } from './taxCodes';

// Phase C3-POLISH-R §4 — the standard Australian tax-code defaults every
// new Commercial (quotes-enabled) organisation needs before its
// Product/Quote tax dropdown is usable at all. Root cause this fixes:
// commercial_tax_codes is a genuinely tenant-configurable table (Phase
// C2's own deliberate design choice — see scripts/create-commercial-core.sql
// §2's header) with NO seed data for any organisation, including the one
// pilot organisation already live in production — so the dropdown is
// empty until something inserts rows into it.
//
// This is a reusable BOOTSTRAP an organisation can run once (or safely
// re-run — see the ON CONFLICT below), not a migration: it writes
// ordinary tenant-scoped commercial_tax_codes rows through the exact
// same table every other tax code (a tenant might add its own) already
// lives in, with no schema change. Kept tenant-scoped rather than a
// platform-wide default so a future non-Australian tenant is never
// silently handed GST — this bootstrap is only ever invoked for one
// explicit organisationId, on request (this phase's new Settings > Tax
// Codes screen), never automatically for every organisation.
export interface StandardTaxCodeDefinition {
  code: string;
  name: string;
  rate: number;
  isDefault: boolean;
}

// GST 10% is the default for a normal taxable sale — matching how an
// Australian business actually prices most of its line items day to
// day. GST Free and No Tax are both 0% but are kept as DISTINCT codes
// (not one "0%" row) because they mean different things on a BAS: GST
// Free covers GST-free supplies (certain food, health, exports), No Tax
// covers line items genuinely outside the tax system (e.g. a
// pass-through reimbursement) — collapsing them would lose that
// distinction on every quote/future-invoice line that uses one.
export const STANDARD_AU_TAX_CODES: StandardTaxCodeDefinition[] = [
  { code: 'GST',      name: 'GST 10%',   rate: 10.00, isDefault: true },
  { code: 'GST_FREE', name: 'GST Free',  rate: 0.00,  isDefault: false },
  { code: 'NO_TAX',   name: 'No Tax',    rate: 0.00,  isDefault: false },
];

export interface TaxCodeBootstrapResult {
  created: CommercialTaxCode[];
  skipped: string[]; // codes that already existed for this organisation (untouched)
}

// Idempotent: commercial_tax_codes already carries UNIQUE(organisation_id, code)
// (scripts/create-commercial-core.sql §2), so ON CONFLICT DO NOTHING is a
// genuine no-op for any code this organisation already has — re-running
// this bootstrap on an organisation that has since customised or
// deactivated its 'GST' row never overwrites that customisation. Runs
// all three inserts as independent statements (not a transaction) since
// each is independently idempotent and a partial application (e.g. GST
// inserted, GST_FREE fails) leaves the table in a perfectly valid state,
// not a half-written one.
export async function seedStandardAustralianTaxCodes(organisationId: string): Promise<TaxCodeBootstrapResult> {
  const created: CommercialTaxCode[] = [];
  const skipped: string[] = [];

  for (const def of STANDARD_AU_TAX_CODES) {
    const rows = (await sql`
      INSERT INTO commercial_tax_codes (organisation_id, code, name, rate, is_default)
      VALUES (${organisationId}, ${def.code}, ${def.name}, ${def.rate}, ${def.isDefault})
      ON CONFLICT (organisation_id, code) DO NOTHING
      RETURNING *
    `) as CommercialTaxCode[];
    if (rows[0]) created.push(rows[0]);
    else skipped.push(def.code);
  }

  return { created, skipped };
}
