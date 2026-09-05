import sql from '@/lib/db';
import { logCostCentreCreated, logCostCentreUpdated, logCostCentreDeactivated } from './auditLog';

// Phase C2 — tenant-scoped data access for commercial_cost_centres.
// Same scoping/audit discipline as lib/commercial/customers.ts and
// lib/commercial/products.ts.

export interface CommercialCostCentre {
  id: string;
  organisation_id: string;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export async function listCostCentres(organisationId: string, opts: { activeOnly?: boolean } = {}): Promise<CommercialCostCentre[]> {
  if (opts.activeOnly) {
    return (await sql`
      SELECT * FROM commercial_cost_centres WHERE organisation_id = ${organisationId} AND active = true ORDER BY code ASC
    `) as CommercialCostCentre[];
  }
  return (await sql`
    SELECT * FROM commercial_cost_centres WHERE organisation_id = ${organisationId} ORDER BY code ASC
  `) as CommercialCostCentre[];
}

export async function getCostCentre(organisationId: string, costCentreId: string): Promise<CommercialCostCentre | null> {
  const rows = (await sql`
    SELECT * FROM commercial_cost_centres WHERE id = ${costCentreId} AND organisation_id = ${organisationId}
  `) as CommercialCostCentre[];
  return rows[0] ?? null;
}

// The (organisation_id, code) UNIQUE constraint is the actual source of
// truth for "no duplicate code per tenant" (scripts/create-commercial-
// core.sql) — this function does not pre-check uniqueness itself; a
// violation surfaces as a thrown Postgres unique-violation error to the
// caller, exactly like every other unique-constrained insert in this
// codebase (e.g. modules.key's ON CONFLICT is a deliberate exception for
// idempotent seeding, not the general pattern for user-initiated create).
export async function createCostCentre(params: {
  organisationId: string; userId: string; code: string; name: string; description?: string | null;
}): Promise<CommercialCostCentre> {
  const rows = (await sql`
    INSERT INTO commercial_cost_centres (organisation_id, code, name, description)
    VALUES (${params.organisationId}, ${params.code}, ${params.name}, ${params.description ?? null})
    RETURNING *
  `) as CommercialCostCentre[];
  const costCentre = rows[0];

  await logCostCentreCreated({
    organisationId: params.organisationId, userId: params.userId, costCentreId: costCentre.id,
    after: { code: costCentre.code, name: costCentre.name },
  });

  return costCentre;
}

export async function updateCostCentre(params: {
  organisationId: string; userId: string; costCentreId: string; name?: string; description?: string | null;
}): Promise<CommercialCostCentre | null> {
  const before = await getCostCentre(params.organisationId, params.costCentreId);
  if (!before) return null;

  const rows = (await sql`
    UPDATE commercial_cost_centres SET
      name = COALESCE(${params.name ?? null}, name),
      description = COALESCE(${params.description}, description),
      updated_at = now()
    WHERE id = ${params.costCentreId} AND organisation_id = ${params.organisationId}
    RETURNING *
  `) as CommercialCostCentre[];
  const after = rows[0];

  await logCostCentreUpdated({
    organisationId: params.organisationId, userId: params.userId, costCentreId: params.costCentreId,
    before: { name: before.name }, after: { name: after.name },
  });

  return after;
}

export async function deactivateCostCentre(params: { organisationId: string; userId: string; costCentreId: string }): Promise<boolean> {
  const rows = (await sql`
    UPDATE commercial_cost_centres SET active = false, updated_at = now()
    WHERE id = ${params.costCentreId} AND organisation_id = ${params.organisationId} AND active = true
    RETURNING id
  `) as { id: string }[];
  if (rows.length === 0) return false;

  await logCostCentreDeactivated({ organisationId: params.organisationId, userId: params.userId, costCentreId: params.costCentreId });
  return true;
}
