// BrainBase Assurance — Settings → Reference data: real-Postgres behaviour proof.
// Shared BrainBase locations, assets and external organisations (A0.1B tables).
// Run ONLY via scripts/tests/verify-assurance-reference-data-settings.sh
// (disposable postgres:17 with the real A0.1B..A0.1E-1 migrations applied).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createNeonCompatibleSql } from './helpers/neonCompatiblePgSql';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('assuranceReferenceDataSettings.integration.test.ts requires DATABASE_URL (see verify-assurance-reference-data-settings.sh).');
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com|vercel/i.test(DATABASE_URL)) {
  throw new Error('Refusing to run against a hosted database. Disposable local Postgres only.');
}
if (!/^(localhost|127\.0\.0\.1)$/.test(new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname)) {
  throw new Error('Refusing to run against a non-localhost DATABASE_URL host.');
}

const sql = createNeonCompatibleSql(DATABASE_URL);
vi.doMock('@/lib/db', () => ({ default: sql }));

type Mods = {
  ref: typeof import('@/lib/referenceData/service');
  adapter: typeof import('@/lib/assurance/referenceData');
  lookups: typeof import('@/lib/assurance/lookups');
  incidents: typeof import('@/lib/assurance/incidents');
  inspections: typeof import('@/lib/assurance/inspections');
  audits: typeof import('@/lib/assurance/audits');
  findings: typeof import('@/lib/assurance/findings');
  risk: typeof import('@/lib/assurance/riskLevels');
};
let m: Mods;

import type { AssuranceViewer } from '@/lib/assurance/policy';
import type { ReferenceDataActor } from '@/lib/referenceData/service';
const V = (organisationId: string, userId: string, role: AssuranceViewer['role']): AssuranceViewer => ({
  organisationId, userId, role, canViewAllRestricted: role === 'admin' || role === 'super_admin',
});
const vAdminA = V('rd-org-a', 'rd-a-admin', 'admin');
const vMgrA = V('rd-org-a', 'rd-a-mgr', 'manager');
const vViewerA = V('rd-org-a', 'rd-a-viewer', 'viewer');
const vSuperA = V('rd-org-a', 'rd-a-super', 'super_admin');
const vAdminB = V('rd-org-b', 'rd-b-admin', 'admin');
let adminA: ReferenceDataActor, mgrA: ReferenceDataActor, viewerA: ReferenceDataActor, superA: ReferenceDataActor, adminB: ReferenceDataActor;

const KINDS = ['location', 'asset', 'external_organisation'] as const;
type Kind = typeof KINDS[number];
const TABLE: Record<Kind, { table: string; ref: string }> = {
  location: { table: 'locations', ref: 'location_reference' },
  asset: { table: 'assets', ref: 'asset_reference' },
  external_organisation: { table: 'external_organisations', ref: 'reference' },
};
const VALID: Record<Kind, Record<string, unknown>> = {
  location: { name: 'Southern Operations Depot', locationType: 'DEPOT', description: 'Main depot', suburb: 'Lonsdale', state: 'SA', countryCode: 'au' },
  asset: { name: 'Waste Truck 001', assetType: 'VEHICLE', externalIdentifier: 'FLEET-001' },
  external_organisation: { name: 'Example Waste Contractor', roles: ['SUPPLIER', 'CONTRACTOR'], businessIdentifier: '12 345 678 901', email: 'ops@example.com', website: 'example.com' },
};

async function expectError(p: Promise<unknown>, cls: string, msg?: RegExp): Promise<Error> {
  let caught: unknown;
  try { await p; } catch (e) { caught = e; }
  expect(caught, `expected ${cls}`).toBeTruthy();
  expect((caught as Error).name, (caught as Error).message).toBe(cls);
  if (msg) expect((caught as Error).message).toMatch(msg);
  return caught as Error;
}

async function row(kind: Kind, id: string) {
  const t = TABLE[kind];
  const [r] = await sql.raw(`SELECT *, ${t.ref} AS ref, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS revision
    FROM ${t.table} WHERE id = '${id}'`) as Record<string, unknown>[];
  return r as Record<string, unknown> & { revision: string; status: string; name: string; organisation_id: string; ref: string };
}
const rev = async (kind: Kind, id: string) => (await row(kind, id)).revision;
async function auditRows(kind: Kind, id?: string) {
  return await sql`SELECT action, user_id, resource_id, before_state, after_state FROM audit_logs
    WHERE resource_type = ${kind} AND (${id ?? null}::text IS NULL OR resource_id = ${id ?? null}::text)
    ORDER BY created_at, id` as { action: string; user_id: string; resource_id: string; before_state: Record<string, unknown> | null; after_state: Record<string, unknown> | null }[];
}
async function roles(id: string) {
  return await sql`SELECT role, active FROM external_organisation_roles WHERE external_organisation_id = ${id}::uuid ORDER BY role` as { role: string; active: boolean }[];
}

const created: Record<Kind, string> = { location: '', asset: '', external_organisation: '' };
let bIds: Record<Kind, string> = { location: '', asset: '', external_organisation: '' };

beforeAll(async () => {
  await sql.raw(`
    INSERT INTO organisations (id, name, slug, updated_at) VALUES
      ('rd-org-a', 'Ref Org A', 'rd-org-a', now()), ('rd-org-b', 'Ref Org B', 'rd-org-b', now()), ('rd-org-c', 'Ref Org C (empty)', 'rd-org-c', now());
    INSERT INTO users (id, organisation_id, username, name, role, status, updated_at) VALUES
      ('rd-a-admin', 'rd-org-a', 'rd-a-admin', 'Ada Admin', 'ADMIN', 'ACTIVE', now()),
      ('rd-a-admin2', 'rd-org-a', 'rd-a-admin2', 'Abe Admin', 'ADMIN', 'ACTIVE', now()),
      ('rd-a-super', 'rd-org-a', 'rd-a-super', 'Sam Super', 'SUPER_ADMIN', 'ACTIVE', now()),
      ('rd-a-mgr', 'rd-org-a', 'rd-a-mgr', 'Mia Manager', 'MANAGER', 'ACTIVE', now()),
      ('rd-a-viewer', 'rd-org-a', 'rd-a-viewer', 'Val Viewer', 'VIEWER', 'ACTIVE', now()),
      ('rd-b-admin', 'rd-org-b', 'rd-b-admin', 'Bo Admin', 'ADMIN', 'ACTIVE', now());
    -- Org B's own records (must never be visible to / changeable by org A).
    INSERT INTO locations (organisation_id, location_reference, location_type, name) VALUES ('rd-org-b', 'B-LOC', 'SITE', 'B Secret Site');
    INSERT INTO assets (organisation_id, asset_reference, asset_type, name) VALUES ('rd-org-b', 'B-ASSET', 'PLANT', 'B Secret Plant');
    INSERT INTO external_organisations (organisation_id, reference, name) VALUES ('rd-org-b', 'B-XO', 'B Secret Supplier');
    -- Platform lifecycle states this screen shows but does not reverse.
    INSERT INTO locations (organisation_id, location_reference, location_type, name, status) VALUES ('rd-org-a', 'ARCH-LOC', 'OTHER', 'Archived Yard', 'ARCHIVED');
    INSERT INTO assets (organisation_id, asset_reference, asset_type, name, status) VALUES ('rd-org-a', 'RET-01', 'EQUIPMENT', 'Retired Compressor', 'RETIRED');
  `);
  m = {
    ref: await import('@/lib/referenceData/service'),
    adapter: await import('@/lib/assurance/referenceData'),
    lookups: await import('@/lib/assurance/lookups'),
    incidents: await import('@/lib/assurance/incidents'),
    inspections: await import('@/lib/assurance/inspections'),
    audits: await import('@/lib/assurance/audits'),
    findings: await import('@/lib/assurance/findings'),
    risk: await import('@/lib/assurance/riskLevels'),
  };
  [adminA, mgrA, viewerA, superA, adminB] = [vAdminA, vMgrA, vViewerA, vSuperA, vAdminB].map(m.adapter.referenceActor);
  const bRows = await sql`SELECT 'location' AS k, id FROM locations WHERE organisation_id = 'rd-org-b'
    UNION ALL SELECT 'asset', id FROM assets WHERE organisation_id = 'rd-org-b'
    UNION ALL SELECT 'external_organisation', id FROM external_organisations WHERE organisation_id = 'rd-org-b'` as { k: Kind; id: string }[];
  bIds = Object.fromEntries(bRows.map(r => [r.k, r.id])) as Record<Kind, string>;
});

afterAll(async () => { await sql.end(); });

describe('permissions', () => {
  it('managers and viewers cannot create, edit, deactivate or reactivate any kind', async () => {
    for (const actor of [mgrA, viewerA]) {
      for (const kind of KINDS) {
        await expectError(m.ref.createReferenceRecord(actor, kind, { reference: 'X1', ...VALID[kind] }), 'AssuranceForbiddenError', /Only organisation admins/);
        await expectError(m.ref.updateReferenceRecord(actor, kind, bIds[kind], { name: 'x', expectedRevision: 'r' }), 'AssuranceForbiddenError');
        await expectError(m.ref.deactivateReferenceRecord(actor, kind, bIds[kind], { expectedRevision: 'r' }), 'AssuranceForbiddenError');
        await expectError(m.ref.reactivateReferenceRecord(actor, kind, bIds[kind], { expectedRevision: 'r' }), 'AssuranceForbiddenError');
      }
    }
    expect(m.ref.canAdministerReferenceData('admin')).toBe(true);
    expect(m.ref.canAdministerReferenceData('super_admin')).toBe(true);
    expect(m.ref.canAdministerReferenceData('manager')).toBe(false);
    expect(m.ref.canAdministerReferenceData('analyst')).toBe(false);
  });
  it('the shared service exposes no delete operation', () => {
    expect(Object.keys(m.ref).filter(k => /delete|remove|purge|destroy/i.test(k))).toEqual([]);
  });
});

describe('create', () => {
  it('creates each kind in the actor\'s organisation with a normalised reference, ACTIVE, audited', async () => {
    for (const kind of KINDS) {
      const r = await m.ref.createReferenceRecord(adminA, kind, { reference: ' test-001 ', ...VALID[kind], organisationId: 'rd-org-b' });
      expect(r.reference).toBe('TEST-001');
      created[kind] = r.id;
      const db = await row(kind, r.id);
      expect(db.organisation_id).toBe('rd-org-a');
      expect(db.status).toBe('ACTIVE');
      expect(db.created_by).toBe('rd-a-admin');
      const [a] = await auditRows(kind, r.id);
      expect(a.action).toBe(`${kind}.created`);
      expect(a.user_id).toBe('rd-a-admin');
      expect(a.before_state).toBeNull();
      expect(a.after_state).toMatchObject({ reference: 'TEST-001', name: VALID[kind].name, status: 'ACTIVE' });
      // Audit carries identifiers/names/status only — no descriptions, addresses or contact details.
      const text = JSON.stringify(a.after_state);
      for (const secret of ['Main depot', 'Lonsdale', 'ops@example.com', 'FLEET-001', '12 345 678 901']) expect(text).not.toContain(secret);
    }
    expect((await row('location', created.location)).country_code).toBe('AU');
    expect((await row('asset', created.asset)).asset_type).toBe('VEHICLE');
    expect((await roles(created.external_organisation)).map(r => [r.role, r.active])).toEqual([['CONTRACTOR', true], ['SUPPLIER', true]]);
    expect((await auditRows('external_organisation', created.external_organisation))[0].after_state?.roles).toEqual(['CONTRACTOR', 'SUPPLIER']);
  });
  it('super_admin inherits the admin capability', async () => {
    const r = await m.ref.createReferenceRecord(superA, 'location', { reference: 'SUPER-1', name: 'Super site', locationType: 'SITE' });
    expect((await row('location', r.id)).created_by).toBe('rd-a-super');
  });
  it('validates input with clear messages', async () => {
    await expectError(m.ref.createReferenceRecord(adminA, 'location', { reference: '', name: 'x', locationType: 'SITE' }), 'AssuranceValidationError', /Reference is required/);
    await expectError(m.ref.createReferenceRecord(adminA, 'location', { reference: 'bad ref!', name: 'x', locationType: 'SITE' }), 'AssuranceValidationError', /Reference must start/);
    await expectError(m.ref.createReferenceRecord(adminA, 'location', { reference: 'R1', name: '  ', locationType: 'SITE' }), 'AssuranceValidationError', /Name is required/);
    await expectError(m.ref.createReferenceRecord(adminA, 'location', { reference: 'R1', name: 'x' }), 'AssuranceValidationError', /Location type is required/);
    await expectError(m.ref.createReferenceRecord(adminA, 'location', { reference: 'R1', name: 'x', locationType: 'MOON' }), 'AssuranceValidationError', /not a recognised value/);
    await expectError(m.ref.createReferenceRecord(adminA, 'location', { reference: 'R1', name: 'x', locationType: 'SITE', countryCode: 'AUS' }), 'AssuranceValidationError', /two letters/);
    await expectError(m.ref.createReferenceRecord(adminA, 'asset', { reference: 'R1', name: 'x', assetType: 'SPACESHIP' }), 'AssuranceValidationError', /not a recognised value/);
    await expectError(m.ref.createReferenceRecord(adminA, 'external_organisation', { reference: 'R1', name: 'x', email: 'not-an-email' }), 'AssuranceValidationError', /valid email/);
    await expectError(m.ref.createReferenceRecord(adminA, 'external_organisation', { reference: 'R1', name: 'x', roles: ['OVERLORD'] }), 'AssuranceValidationError', /not allowed/);
    await expectError(m.ref.createReferenceRecord(adminA, 'external_organisation', { reference: 'R1', name: 'x', website: 'not a site' }), 'AssuranceValidationError', /web address/);
    expect((await sql`SELECT count(*)::int AS n FROM locations WHERE location_reference = 'R1'`)[0].n).toBe(0);
  });
  it('references are unique per organisation (case-insensitive via normalisation), including inactive; other orgs may reuse', async () => {
    for (const kind of KINDS) {
      await expectError(m.ref.createReferenceRecord(adminA, kind, { reference: 'test-001', ...VALID[kind] }), 'AssuranceConflictError', /already exists/);
    }
    await expectError(m.ref.createReferenceRecord(adminA, 'location', { reference: 'arch-loc', name: 'x', locationType: 'SITE' }), 'AssuranceConflictError', /already exists/);
    const b = await m.ref.createReferenceRecord(adminB, 'location', { reference: 'TEST-001', name: 'B own TEST-001', locationType: 'SITE' });
    expect((await row('location', b.id)).organisation_id).toBe('rd-org-b');
  });
  it('two concurrent creates with the same reference: exactly one succeeds', async () => {
    const results = await Promise.allSettled([
      m.ref.createReferenceRecord(adminA, 'asset', { reference: 'RACE-1', name: 'Race A', assetType: 'PLANT' }),
      m.ref.createReferenceRecord(m.adapter.referenceActor(V('rd-org-a', 'rd-a-admin2', 'admin')), 'asset', { reference: 'RACE-1', name: 'Race B', assetType: 'PLANT' }),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rej = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect((rej.reason as Error).name).toBe('AssuranceConflictError');
    expect((await sql`SELECT count(*)::int AS n FROM assets WHERE organisation_id = 'rd-org-a' AND asset_reference = 'RACE-1'`)[0].n).toBe(1);
    expect((await sql`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'asset.created' AND after_state->>'reference' = 'RACE-1'`)[0].n).toBe(1);
  });
});

describe('list and tenant isolation', () => {
  it('lists every status for the actor\'s organisation only, active first', async () => {
    const locs = await m.ref.listReferenceRecords(adminA, 'location');
    expect(locs.map(r => r.reference)).toContain('ARCH-LOC');
    expect(locs.map(r => r.reference)).not.toContain('B-LOC');
    expect(locs[locs.length - 1].status).toBe('ARCHIVED');
    const assets = await m.ref.listReferenceRecords(adminA, 'asset');
    expect(assets.find(r => r.reference === 'RET-01')?.status).toBe('RETIRED');
    for (const kind of KINDS) {
      expect((await m.ref.listReferenceRecords(adminA, kind)).map(r => r.id)).not.toContain(bIds[kind]);
      expect((await m.ref.listReferenceRecords(adminB, kind)).map(r => r.id)).toContain(bIds[kind]);
      expect(await m.ref.listReferenceRecords(m.adapter.referenceActor(V('rd-org-c', 'x', 'admin')), kind)).toEqual([]);
    }
    const xo = (await m.ref.listReferenceRecords(adminA, 'external_organisation')).find(r => r.id === created.external_organisation)!;
    expect(xo.fields.roles).toEqual(['CONTRACTOR', 'SUPPLIER']);
    expect(xo.fields.email).toBe('ops@example.com');
  });
  it('usage counts only for actors who may see every record', async () => {
    expect((await m.ref.listReferenceRecords(adminA, 'location'))[0].usage_count).toBe(0);
    expect((await m.ref.listReferenceRecords(mgrA, 'location'))[0].usage_count).toBeNull();
  });
  it('summary counts are organisation-scoped', async () => {
    const s = await m.ref.summariseReferenceData('rd-org-a');
    const loc = s.find(x => x.kind === 'location')!;
    expect(loc.total).toBeGreaterThan(loc.active);
    expect((await m.ref.summariseReferenceData('rd-org-c')).every(x => x.total === 0)).toBe(true);
  });
  it('another organisation\'s record is "not found" for edit, deactivate and reactivate — and is unchanged', async () => {
    for (const kind of KINDS) {
      const theirs = await rev(kind, bIds[kind]);
      await expectError(m.ref.updateReferenceRecord(adminA, kind, bIds[kind], { name: 'Hacked', expectedRevision: theirs }), 'AssuranceNotFoundError');
      await expectError(m.ref.deactivateReferenceRecord(adminA, kind, bIds[kind], { expectedRevision: theirs }), 'AssuranceNotFoundError');
      await expectError(m.ref.reactivateReferenceRecord(adminA, kind, bIds[kind], { expectedRevision: theirs }), 'AssuranceNotFoundError');
      await expectError(m.ref.updateReferenceRecord(adminA, kind, 'not-a-uuid', { name: 'x', expectedRevision: 'x' }), 'AssuranceNotFoundError');
      const after = await row(kind, bIds[kind]);
      expect(after.status).toBe('ACTIVE');
      expect(after.name).toMatch(/^B Secret/);
      expect(after.revision).toBe(theirs);
    }
    expect((await sql`SELECT count(*)::int AS n FROM audit_logs WHERE organisation_id = 'rd-org-b'`)[0].n).toBe(1); // only B's own create
  });
  it('new-record selectors offer only the organisation\'s ACTIVE records', async () => {
    const locs = await m.lookups.listLocationOptions('rd-org-a');
    expect(locs.map(o => o.id)).toContain(created.location);
    expect(locs.map(o => o.reference)).not.toContain('ARCH-LOC');
    expect(locs.map(o => o.id)).not.toContain(bIds.location);
    expect((await m.lookups.listAssetOptions('rd-org-a')).map(o => o.reference)).not.toContain('RET-01');
    expect((await m.lookups.listExternalOrganisationOptions('rd-org-a')).map(o => o.id)).toEqual([created.external_organisation]);
  });
});

describe('edit', () => {
  it('updates descriptive fields; a partial body keeps the rest; audit has before/after and changed fields', async () => {
    const id = created.location;
    await m.ref.updateReferenceRecord(adminA, 'location', id, { name: 'Southern Ops Depot', postcode: '5160', expectedRevision: await rev('location', id) });
    const db = await row('location', id);
    expect(db.name).toBe('Southern Ops Depot');
    expect(db.postcode).toBe('5160');
    expect(db.suburb).toBe('Lonsdale');
    expect(db.description).toBe('Main depot');
    const a = (await auditRows('location', id)).at(-1)!;
    expect(a.action).toBe('location.updated');
    expect(a.before_state).toMatchObject({ name: 'Southern Operations Depot', reference: 'TEST-001' });
    expect(a.after_state).toMatchObject({ name: 'Southern Ops Depot', changed_fields: ['name', 'postcode'] });
    expect(JSON.stringify(a.after_state)).not.toContain('5160');
  });
  it('can clear an optional field', async () => {
    const id = created.asset;
    await m.ref.updateReferenceRecord(adminA, 'asset', id, { externalIdentifier: '', expectedRevision: await rev('asset', id) });
    expect((await row('asset', id)).external_identifier).toBeNull();
  });
  it('the reference is immutable', async () => {
    const id = created.asset;
    await expectError(m.ref.updateReferenceRecord(adminA, 'asset', id, { reference: 'NEW-REF', name: 'x', expectedRevision: await rev('asset', id) }), 'AssuranceValidationError', /cannot be changed/);
    await m.ref.updateReferenceRecord(adminA, 'asset', id, { reference: 'test-001', name: 'Waste Truck 001A', expectedRevision: await rev('asset', id) });
    expect((await row('asset', id)).ref).toBe('TEST-001');
  });
  it('refuses a stale revision and a no-op', async () => {
    const id = created.location;
    const old = await rev('location', id);
    await m.ref.updateReferenceRecord(adminA, 'location', id, { description: 'Depot (updated)', expectedRevision: old });
    await expectError(m.ref.updateReferenceRecord(adminA, 'location', id, { description: 'Stale overwrite', expectedRevision: old }), 'AssuranceConflictError', /changed by someone else/);
    expect((await row('location', id)).description).toBe('Depot (updated)');
    await expectError(m.ref.updateReferenceRecord(adminA, 'location', id, { name: 'Southern Ops Depot', expectedRevision: await rev('location', id) }), 'AssuranceValidationError', /Nothing to save/);
    await expectError(m.ref.updateReferenceRecord(adminA, 'location', id, { name: 'x' }), 'AssuranceValidationError', /out of date/);
  });
  it('external organisation roles sync: added roles activate, removed roles deactivate (rows kept)', async () => {
    const id = created.external_organisation;
    await m.ref.updateReferenceRecord(adminA, 'external_organisation', id, { roles: ['CONTRACTOR', 'CUSTOMER'], expectedRevision: await rev('external_organisation', id) });
    expect((await roles(id)).map(r => [r.role, r.active])).toEqual([['CONTRACTOR', true], ['CUSTOMER', true], ['SUPPLIER', false]]);
    const a = (await auditRows('external_organisation', id)).at(-1)!;
    expect(a.before_state?.roles).toEqual(['CONTRACTOR', 'SUPPLIER']);
    expect(a.after_state?.roles).toEqual(['CONTRACTOR', 'CUSTOMER']);
    expect(a.after_state?.changed_fields).toEqual(['roles']);
    await m.ref.updateReferenceRecord(adminA, 'external_organisation', id, { roles: ['SUPPLIER', 'CONTRACTOR', 'CUSTOMER'], expectedRevision: await rev('external_organisation', id) });
    expect((await roles(id)).every(r => r.active)).toBe(true);
    expect((await roles(id))).toHaveLength(3);
  });
  it('two concurrent edits from the same revision: exactly one wins, the other is refused', async () => {
    const id = created.asset;
    const r0 = await rev('asset', id);
    const admin2 = m.adapter.referenceActor(V('rd-org-a', 'rd-a-admin2', 'admin'));
    const results = await Promise.allSettled([
      m.ref.updateReferenceRecord(adminA, 'asset', id, { description: 'Edit A', expectedRevision: r0 }),
      m.ref.updateReferenceRecord(admin2, 'asset', id, { description: 'Edit B', expectedRevision: r0 }),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason as Error).name).toBe('AssuranceConflictError');
    expect(['Edit A', 'Edit B']).toContain((await row('asset', id)).description);
    expect((await sql`SELECT count(*)::int AS n FROM audit_logs WHERE resource_id = ${id} AND action = 'asset.updated' AND after_state->'changed_fields' ? 'description'`)[0].n).toBe(1);
  });
});

describe('deactivate / reactivate with historical Assurance records', () => {
  const hist: Record<string, string> = {};
  beforeAll(async () => {
    const refs = { locationId: created.location, assetId: created.asset, externalOrganisationId: created.external_organisation };
    hist.incident = (await m.incidents.createIncident(vMgrA, { title: 'Ref incident', description: 'd', category: 'OTHER', occurredAt: new Date(Date.now() - 3600e3).toISOString(), ...refs })).id;
    hist.inspection = (await m.inspections.createInspection(vMgrA, { title: 'Ref inspection', inspectionType: 'SITE', ...refs })).id;
    hist.audit = (await m.audits.createAudit(vMgrA, { title: 'Ref audit', scope: 's', auditType: 'SITE', standardReference: 'ISO 45001', ...refs })).id;
    hist.finding = (await m.findings.createFinding(vMgrA, {
      incidentId: hist.incident, findingType: 'HAZARD', title: 'Ref finding', description: 'd',
      locationId: created.location, assetId: created.asset, responsibleExternalOrganisationId: created.external_organisation,
    })).id;
  });

  it('usage counts reflect the referencing records', async () => {
    const loc = (await m.ref.listReferenceRecords(adminA, 'location')).find(r => r.id === created.location)!;
    expect(loc.usage_count).toBe(4); // incident + inspection + audit + finding
    const xo = (await m.ref.listReferenceRecords(adminA, 'external_organisation')).find(r => r.id === created.external_organisation)!;
    expect(xo.usage_count).toBe(4);
  });

  it('deactivating a referenced record: status INACTIVE, audited, gone from selectors, still on every existing record', async () => {
    for (const kind of KINDS) {
      await m.ref.deactivateReferenceRecord(adminA, kind, created[kind], { expectedRevision: await rev(kind, created[kind]) });
      expect((await row(kind, created[kind])).status).toBe('INACTIVE');
      const a = (await auditRows(kind, created[kind])).at(-1)!;
      expect(a.action).toBe(`${kind}.deactivated`);
      expect(a.before_state?.status).toBe('ACTIVE');
      expect(a.after_state?.status).toBe('INACTIVE');
    }
    expect((await m.lookups.listLocationOptions('rd-org-a')).map(o => o.id)).not.toContain(created.location);
    expect((await m.lookups.listAssetOptions('rd-org-a')).map(o => o.id)).not.toContain(created.asset);
    expect((await m.lookups.listExternalOrganisationOptions('rd-org-a')).map(o => o.id)).not.toContain(created.external_organisation);

    const inc = (await m.incidents.getIncidentDetail(vAdminA, hist.incident))!.incident;
    expect([inc.location_name, inc.asset_name, inc.external_organisation_name]).toEqual(['Southern Ops Depot', 'Waste Truck 001A', 'Example Waste Contractor']);
    const ins = (await m.inspections.getInspectionDetail(vAdminA, hist.inspection))!.inspection;
    expect([ins.location_name, ins.asset_name, ins.external_organisation_name]).toEqual(['Southern Ops Depot', 'Waste Truck 001A', 'Example Waste Contractor']);
    const aud = (await m.audits.getAuditDetail(vAdminA, hist.audit))!.audit;
    expect([aud.location_name, aud.asset_name, aud.external_organisation_name]).toEqual(['Southern Ops Depot', 'Waste Truck 001A', 'Example Waste Contractor']);
    const fnd = (await m.findings.getFindingDetail(vAdminA, hist.finding))!.finding;
    expect([fnd.location_name, fnd.asset_name, fnd.responsible_external_organisation_name]).toEqual(['Southern Ops Depot', 'Waste Truck 001A', 'Example Waste Contractor']);
    // Nothing was nullified or reassigned.
    expect((await sql`SELECT location_id::text, asset_id::text, external_organisation_id::text FROM assurance_incidents WHERE id = ${hist.incident}::uuid`)[0])
      .toEqual({ location_id: created.location, asset_id: created.asset, external_organisation_id: created.external_organisation });
  });

  it('an inactive record is refused on a NEW record even when posted directly', async () => {
    const now = new Date(Date.now() - 60e3).toISOString();
    await expectError(m.incidents.createIncident(vMgrA, { title: 'x', description: 'd', category: 'OTHER', occurredAt: now, locationId: created.location }), 'AssuranceValidationError', /Location is inactive/);
    await expectError(m.inspections.createInspection(vMgrA, { title: 'x', inspectionType: 'SITE', assetId: created.asset }), 'AssuranceValidationError', /Asset is inactive/);
    await expectError(m.audits.createAudit(vMgrA, { title: 'x', scope: 's', auditType: 'SITE', standardReference: 'x', externalOrganisationId: created.external_organisation }), 'AssuranceValidationError', /External organisation is inactive/);
    await expectError(m.findings.createFinding(vMgrA, { incidentId: hist.incident, findingType: 'HAZARD', title: 'x', description: 'd', locationId: created.location }), 'AssuranceValidationError', /Location is inactive/);
    // Another organisation's id is still "not found", never "inactive".
    await expectError(m.incidents.createIncident(vMgrA, { title: 'x', description: 'd', category: 'OTHER', occurredAt: now, locationId: bIds.location }), 'AssuranceValidationError', /not found in your organisation/);
  });

  it('list-page filters can still include inactive records (flagged)', async () => {
    const all = await m.lookups.listLocationOptions('rd-org-a', { includeInactive: true });
    expect(all.find(o => o.id === created.location)?.inactive).toBe(true);
    expect(all.find(o => o.reference === 'ARCH-LOC')?.inactive).toBe(true);
    expect(all.map(o => o.id)).not.toContain(bIds.location);
    const filtered = await m.incidents.listIncidents(vAdminA, { locationId: created.location } as never);
    expect(filtered.map(r => r.id)).toContain(hist.incident);
  });

  it('already-inactive and platform-archived/retired records are refused with clear conflicts', async () => {
    await expectError(m.ref.deactivateReferenceRecord(adminA, 'location', created.location, { expectedRevision: await rev('location', created.location) }), 'AssuranceConflictError', /already inactive/);
    const arch = (await m.ref.listReferenceRecords(adminA, 'location')).find(r => r.reference === 'ARCH-LOC')!;
    await expectError(m.ref.reactivateReferenceRecord(adminA, 'location', arch.id, { expectedRevision: arch.revision }), 'AssuranceConflictError', /archived and cannot be reactivated/);
    const ret = (await m.ref.listReferenceRecords(adminA, 'asset')).find(r => r.reference === 'RET-01')!;
    await expectError(m.ref.reactivateReferenceRecord(adminA, 'asset', ret.id, { expectedRevision: ret.revision }), 'AssuranceConflictError', /retired and cannot be reactivated/);
    await expectError(m.ref.deactivateReferenceRecord(adminA, 'asset', ret.id, { expectedRevision: ret.revision }), 'AssuranceConflictError', /retired and cannot be deactivated/);
  });

  it('reactivating returns each record to the selectors; stale revisions are refused; audited', async () => {
    for (const kind of KINDS) {
      await expectError(m.ref.reactivateReferenceRecord(adminA, kind, created[kind], { expectedRevision: '2000-01-01T00:00:00.000000' }), 'AssuranceConflictError', /changed by someone else/);
      await m.ref.reactivateReferenceRecord(adminA, kind, created[kind], { expectedRevision: await rev(kind, created[kind]) });
      expect((await row(kind, created[kind])).status).toBe('ACTIVE');
      expect((await auditRows(kind, created[kind])).at(-1)!.action).toBe(`${kind}.reactivated`);
    }
    expect((await m.lookups.listLocationOptions('rd-org-a')).map(o => o.id)).toContain(created.location);
    expect((await m.lookups.listAssetOptions('rd-org-a')).map(o => o.id)).toContain(created.asset);
    expect((await m.lookups.listExternalOrganisationOptions('rd-org-a')).map(o => o.id)).toContain(created.external_organisation);
    const ok = await m.incidents.createIncident(vMgrA, { title: 'After reactivation', description: 'd', category: 'OTHER', occurredAt: new Date(Date.now() - 60e3).toISOString(), locationId: created.location });
    expect(ok.id).toBeTruthy();
  });

  it('audit history lists the full lifecycle for the organisation only', async () => {
    const h = await m.ref.listReferenceHistory(adminA, 'location', 100);
    const mine = h.filter(x => x.reference === 'TEST-001').map(x => x.action.split('.')[1]).reverse();
    expect(mine).toEqual(['created', 'updated', 'updated', 'deactivated', 'reactivated']);
    expect((await m.ref.listReferenceHistory(adminB, 'location', 100)).every(x => x.reference !== 'SUPER-1')).toBe(true);
  });
});

describe('regression', () => {
  it('risk levels are untouched by reference-data changes', async () => {
    expect(await m.risk.listRiskLevelsForAdmin(vAdminA)).toEqual([]);
    expect((await sql`SELECT count(*)::int AS n FROM audit_logs WHERE resource_type = 'assurance_risk_level'`)[0].n).toBe(0);
  });
});
