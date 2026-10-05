import 'server-only';
import sql from '@/lib/db';
import { AssuranceValidationError } from './errors';

// BrainBase Assurance — shared BrainBase reference data (risk levels,
// locations, assets, external organisations, People). Assurance never
// duplicates these entities; it only reads them, tenant scoped.
//
// PII minimisation: People options expose display name + job title only.
// No email, phone, employment or HR fields are selected anywhere in
// Assurance.

export type RiskLevelOption = { id: string; code: string; name: string; rank: number; requires_verification: boolean };
export type NamedOption = { id: string; name: string; reference: string | null; inactive?: boolean };

/**
 * New-record selectors use the default (ACTIVE only). includeInactive is for
 * list-page FILTERS only, so existing records that reference a since-
 * deactivated location / asset / external organisation can still be found.
 */
export type OptionScope = { includeInactive?: boolean };
export type PersonOption = { id: string; display_name: string; job_title: string | null };

export async function listRiskLevels(organisationId: string): Promise<RiskLevelOption[]> {
  return (await sql`
    SELECT id, code, name, rank, requires_verification
    FROM assurance_risk_levels
    WHERE organisation_id = ${organisationId} AND is_active = true
    ORDER BY rank DESC
  `) as RiskLevelOption[];
}

export async function listLocationOptions(organisationId: string, opts: OptionScope = {}): Promise<NamedOption[]> {
  const all = opts.includeInactive === true;
  return (await sql`
    SELECT id, name, location_reference AS reference, status <> 'ACTIVE' AS inactive
    FROM locations
    WHERE organisation_id = ${organisationId} AND (${all}::boolean OR status = 'ACTIVE')
    ORDER BY (status = 'ACTIVE') DESC, name ASC
    LIMIT 500
  `) as NamedOption[];
}

export async function listAssetOptions(organisationId: string, opts: OptionScope = {}): Promise<NamedOption[]> {
  const all = opts.includeInactive === true;
  return (await sql`
    SELECT id, name, asset_reference AS reference, status <> 'ACTIVE' AS inactive
    FROM assets
    WHERE organisation_id = ${organisationId} AND (${all}::boolean OR status = 'ACTIVE')
    ORDER BY (status = 'ACTIVE') DESC, name ASC
    LIMIT 500
  `) as NamedOption[];
}

export async function listExternalOrganisationOptions(organisationId: string, opts: OptionScope = {}): Promise<NamedOption[]> {
  const all = opts.includeInactive === true;
  return (await sql`
    SELECT id, name, reference, status <> 'ACTIVE' AS inactive
    FROM external_organisations
    WHERE organisation_id = ${organisationId} AND (${all}::boolean OR status = 'ACTIVE')
    ORDER BY (status = 'ACTIVE') DESC, name ASC
    LIMIT 500
  `) as NamedOption[];
}

export async function listPersonOptions(organisationId: string): Promise<PersonOption[]> {
  return (await sql`
    SELECT id,
           COALESCE(NULLIF(btrim(preferred_name), ''), first_name) || ' ' || last_name AS display_name,
           job_title
    FROM hr_people
    WHERE organisation_id = ${organisationId}
    ORDER BY last_name ASC, first_name ASC
    LIMIT 1000
  `) as PersonOption[];
}

export type ContextRefs = {
  riskLevelId?: string | null;
  locationId?: string | null;
  assetId?: string | null;
  externalOrganisationId?: string | null;
  personIds?: string[];
};

/**
 * Confirms every supplied shared-entity id belongs to the organisation.
 * The composite (organisation_id, id) FKs already make a cross-tenant link
 * impossible at the DB level; this pre-check turns that into a clear 400
 * instead of an opaque FK failure, and never reveals whether the id
 * exists in another tenant.
 */
export async function assertContextRefsInOrg(organisationId: string, refs: ContextRefs): Promise<void> {
  const checks: Array<{ field: string; ok: Promise<boolean> }> = [];
  const one = (field: string, q: Promise<unknown[]>) =>
    checks.push({ field, ok: q.then(r => r.length === 1) });
  // Shared reference data (locations, assets, external organisations) must
  // be ACTIVE to be attached to a NEW record — the same rule as the
  // selectors. Every caller is a create path; existing records keep
  // whatever they already reference.
  const inactive: string[] = [];
  const active = (field: string, q: Promise<Record<string, unknown>[]>) =>
    checks.push({ field, ok: q.then(r => {
      if (r.length !== 1) return false;
      if (r[0].status !== 'ACTIVE') inactive.push(field);
      return true;
    }) });

  if (refs.riskLevelId) {
    one('Risk level', sql`SELECT 1 FROM assurance_risk_levels WHERE organisation_id = ${organisationId} AND id = ${refs.riskLevelId} AND is_active = true` as Promise<unknown[]>);
  }
  if (refs.locationId) {
    active('Location', sql`SELECT status FROM locations WHERE organisation_id = ${organisationId} AND id = ${refs.locationId}` as Promise<Record<string, unknown>[]>);
  }
  if (refs.assetId) {
    active('Asset', sql`SELECT status FROM assets WHERE organisation_id = ${organisationId} AND id = ${refs.assetId}` as Promise<Record<string, unknown>[]>);
  }
  if (refs.externalOrganisationId) {
    active('External organisation', sql`SELECT status FROM external_organisations WHERE organisation_id = ${organisationId} AND id = ${refs.externalOrganisationId}` as Promise<Record<string, unknown>[]>);
  }
  if (refs.personIds && refs.personIds.length > 0) {
    const ids = refs.personIds;
    checks.push({
      field: 'Person',
      ok: (sql`SELECT id FROM hr_people WHERE organisation_id = ${organisationId} AND id = ANY(${ids}::uuid[])` as Promise<unknown[]>)
        .then(r => r.length === ids.length),
    });
  }

  const results = await Promise.all(checks.map(c => c.ok));
  const failed = checks.find((_, i) => !results[i]);
  if (failed) throw new AssuranceValidationError(`${failed.field} was not found in your organisation.`);
  if (inactive.length > 0) {
    throw new AssuranceValidationError(`${inactive[0]} is inactive and cannot be used on new records.`);
  }
}
