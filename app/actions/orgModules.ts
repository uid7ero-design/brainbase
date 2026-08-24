'use server';
import sql from '@/lib/db';
import { getSession } from '@/lib/session';
import { revalidatePath } from 'next/cache';

// Modular Platform Foundation Phase F.6I — the first admin control
// surface for platform capability entitlement. This is a CONTROL
// MECHANISM only: it lets a super_admin toggle organisation_modules
// rows for an explicitly selected organisation. It grants nothing by
// merely existing — a row only changes when a super_admin actually
// calls setOrganisationCapability. It never reads organisations.plan,
// never references any integration table, and never calls
// requireCapability()/checkCapability() (this is administration, not
// runtime enforcement — lib/capabilities/requireCapability.ts remains
// the sole future enforcement authority for customer routes).

async function requireSuperAdmin() {
  const session = await getSession();
  if (!session || session.role !== 'super_admin') throw new Error('Unauthorized');
}

export type OrganisationCapability = {
  key: string;
  name: string;
  description: string | null;
  active: boolean;
  enabled: boolean;
};

// Target organisationId is always an explicit argument supplied by the
// /admin/orgs caller — never session.organisationId, never org_override.
// Organisation ids are opaque TEXT throughout; never cast to ::uuid.
export async function getOrganisationCapabilities(organisationId: string): Promise<OrganisationCapability[]> {
  await requireSuperAdmin();

  try {
    const [org] = await sql`SELECT id FROM organisations WHERE id = ${organisationId} LIMIT 1`;
    if (!org) throw new Error('Organisation not found.');

    const rows = await sql`
      SELECT
        m.key,
        m.name,
        m.description,
        m.active,
        COALESCE(om.enabled, false) AS enabled
      FROM modules m
      LEFT JOIN organisation_modules om
        ON om.module_key = m.key AND om.organisation_id = ${organisationId}
      ORDER BY m.name
    `;
    return rows as OrganisationCapability[];
  } catch (err) {
    if (err instanceof Error && err.message === 'Organisation not found.') throw err;
    throw new Error('Unable to load capabilities.');
  }
}

export type SetCapabilityResult = { ok: true } | { ok: false; error: string };

// Enable/disable lifecycle (locked, Phase F.6I):
//   enable,  no row        -> INSERT enabled=true (config defaults to {})
//   enable,  disabled row  -> UPDATE enabled=true, config preserved
//   enable,  enabled row   -> idempotent no-op (still resolves ok)
//   disable, enabled row   -> UPDATE enabled=false, config preserved
//   disable, disabled row  -> idempotent no-op (still resolves ok)
//   disable, no row        -> SUCCESSFUL NO-OP — never INSERT a row
// A globally inactive capability may never be newly enabled, but an
// existing entitlement for it may always be disabled.
export async function setOrganisationCapability(
  organisationId: string,
  capabilityKey: string,
  enabled: boolean,
): Promise<SetCapabilityResult> {
  await requireSuperAdmin();

  try {
    const [org] = await sql`SELECT id FROM organisations WHERE id = ${organisationId} LIMIT 1`;
    if (!org) return { ok: false, error: 'Organisation not found.' };

    const [capability] = await sql`SELECT key, active FROM modules WHERE key = ${capabilityKey} LIMIT 1`;
    if (!capability) return { ok: false, error: 'Unknown capability.' };

    if (enabled) {
      if (!capability.active) return { ok: false, error: 'This capability is not currently active.' };
      await sql`
        INSERT INTO organisation_modules (organisation_id, module_key, enabled, updated_at)
        VALUES (${organisationId}, ${capabilityKey}, true, now())
        ON CONFLICT (organisation_id, module_key)
        DO UPDATE SET enabled = true, updated_at = now()
      `;
    } else {
      // Locked override: disabling with no existing entitlement row is
      // a successful no-op. An UPDATE matching zero rows satisfies this
      // by construction — never INSERT here.
      await sql`
        UPDATE organisation_modules
        SET enabled = false, updated_at = now()
        WHERE organisation_id = ${organisationId} AND module_key = ${capabilityKey}
      `;
    }

    revalidatePath('/admin/orgs');
    return { ok: true };
  } catch {
    return { ok: false, error: 'Unable to update capability.' };
  }
}
