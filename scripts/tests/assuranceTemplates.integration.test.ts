// BrainBase Assurance — Templates (A0.1F lifecycle): real-Postgres proof.
// Run ONLY via scripts/tests/verify-assurance-templates.sh (disposable postgres:17 with the
// real A0.1B..A0.1E-1 migrations and A0.1F applied).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createNeonCompatibleSql } from './helpers/neonCompatiblePgSql';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('assuranceTemplates.integration.test.ts requires DATABASE_URL (see verify-assurance-templates.sh).');
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com|vercel/i.test(DATABASE_URL)) {
  throw new Error('Refusing to run against a hosted database. Disposable local Postgres only.');
}
if (!/^(localhost|127\.0\.0\.1)$/.test(new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname)) {
  throw new Error('Refusing to run against a non-localhost DATABASE_URL host.');
}

const sql = createNeonCompatibleSql(DATABASE_URL);
vi.doMock('@/lib/db', () => ({ default: sql }));

type Mods = {
  tl: typeof import('@/lib/assurance/templateLifecycle');
  inspections: typeof import('@/lib/assurance/inspections');
  audits: typeof import('@/lib/assurance/audits');
  findings: typeof import('@/lib/assurance/findings');
};
let m: Mods;

import type { AssuranceViewer } from '@/lib/assurance/policy';
const V = (organisationId: string, userId: string, role: AssuranceViewer['role']): AssuranceViewer => ({
  organisationId, userId, role, canViewAllRestricted: role === 'admin' || role === 'super_admin',
});
const adminA = V('tp-org-a', 'tp-a-admin', 'admin');
const admin2A = V('tp-org-a', 'tp-a-admin2', 'admin');
const mgrA = V('tp-org-a', 'tp-a-mgr', 'manager');
const viewerA = V('tp-org-a', 'tp-a-viewer', 'viewer');
const adminB = V('tp-org-b', 'tp-b-admin', 'admin');
const mgrB = V('tp-org-b', 'tp-b-mgr', 'manager');

async function expectError(p: Promise<unknown>, cls: string, msg?: RegExp): Promise<Error> {
  let caught: unknown;
  try { await p; } catch (e) { caught = e; }
  expect(caught, `expected ${cls}`).toBeTruthy();
  expect((caught as Error).name, (caught as Error).message).toBe(cls);
  if (msg) expect((caught as Error).message).toMatch(msg);
  return caught as Error;
}
async function sqlState(p: Promise<unknown>): Promise<string> {
  try { await p; return 'OK'; } catch (e) { return String((e as { code?: string }).code); }
}
async function auditRows(templateId: string) {
  return await sql`SELECT action, user_id, after_state FROM audit_logs WHERE resource_id = ${templateId} ORDER BY created_at, id` as
    { action: string; user_id: string; after_state: Record<string, unknown> }[];
}
async function versionRow(table: 'inspection' | 'audit', id: string) {
  const rows = table === 'inspection'
    ? await sql`SELECT status, lock_version, published_by, retired_by, published_at, retired_at FROM assurance_inspection_template_versions WHERE id = ${id}::uuid`
    : await sql`SELECT status, lock_version, published_by, retired_by, published_at, retired_at FROM assurance_audit_template_versions WHERE id = ${id}::uuid`;
  return rows[0] as { status: string; lock_version: number; published_by: string | null; retired_by: string | null; published_at: Date | null; retired_at: Date | null };
}

const INSPECTION_ITEMS = [
  { label: 'Walkways clear', responseType: 'PASS_FAIL', section: 'Access' },
  { label: 'Exit signs lit', responseType: 'PASS_FAIL', section: 'Access' },
  { label: 'Extinguisher pressure (psi)', responseType: 'NUMBER', required: false, section: 'Fire' },
];

beforeAll(async () => {
  await sql.raw(`
    INSERT INTO organisations (id, name, slug, updated_at) VALUES
      ('tp-org-a', 'Template Org A', 'tp-org-a', now()), ('tp-org-b', 'Template Org B', 'tp-org-b', now());
    INSERT INTO users (id, organisation_id, username, name, role, status, updated_at) VALUES
      ('tp-a-admin', 'tp-org-a', 'tp-a-admin', 'Ada Admin', 'ADMIN', 'ACTIVE', now()),
      ('tp-a-admin2', 'tp-org-a', 'tp-a-admin2', 'Abe Admin', 'ADMIN', 'ACTIVE', now()),
      ('tp-a-mgr', 'tp-org-a', 'tp-a-mgr', 'Mia Manager', 'MANAGER', 'ACTIVE', now()),
      ('tp-a-viewer', 'tp-org-a', 'tp-a-viewer', 'Val Viewer', 'VIEWER', 'ACTIVE', now()),
      ('tp-b-admin', 'tp-org-b', 'tp-b-admin', 'Bo Admin', 'ADMIN', 'ACTIVE', now()),
      ('tp-b-mgr', 'tp-org-b', 'tp-b-mgr', 'Bea Manager', 'MANAGER', 'ACTIVE', now());
  `);
  m = {
    tl: await import('@/lib/assurance/templateLifecycle'),
    inspections: await import('@/lib/assurance/inspections'),
    audits: await import('@/lib/assurance/audits'),
    findings: await import('@/lib/assurance/findings'),
  };
});

afterAll(async () => { await sql.end(); });

describe('draft lifecycle', () => {
  it('a new template is a DRAFT v1 that is not selectable or bindable until published', async () => {
    const t = await m.tl.createAssuranceTemplate(adminA, { kind: 'inspection', name: '[TEST] Draft only', templateType: 'SITE', items: INSPECTION_ITEMS });
    const d = await m.tl.getAssuranceTemplate(adminA, 'inspection', t.id);
    expect(d!.template).toMatchObject({ status: 'DRAFT', is_active: false });
    expect(d!.draft).toMatchObject({ version_number: 1, status: 'DRAFT', lock_version: 1, published_at: null });
    expect(d!.identityEditable).toBe(true);
    expect((await versionRow('inspection', t.version_id))).toMatchObject({ status: 'DRAFT', published_by: null, published_at: null });
    expect((await m.tl.listPublishedTemplateOptions(mgrA, 'inspection')).some(o => o.template_id === t.id)).toBe(false);
    await expectError(m.inspections.createInspection(mgrA, { title: 'x', templateVersionId: t.version_id }), 'AssuranceValidationError', /not published/);
    // The database refuses it too, independent of the service check.
    expect(await sqlState(sql`INSERT INTO assurance_inspections (organisation_id, inspection_reference, template_version_id, inspection_type, title)
      VALUES ('tp-org-a', 'INS-TP-RAW1', ${t.version_id}::uuid, 'SITE', 'raw')`)).toBe('AT002');
  });

  it('draft saves are guarded on lock_version; identity is editable until first publication', async () => {
    const t = await m.tl.createAssuranceTemplate(adminA, { kind: 'inspection', name: '[TEST] Lock', templateType: 'SITE', items: [] });
    const s1 = await m.tl.updateTemplateDraft(adminA, t.id, {
      kind: 'inspection', versionId: t.version_id, lockVersion: 1, title: 'Lock v1', items: INSPECTION_ITEMS,
      name: '[TEST] Lock (renamed)', templateType: 'SAFETY', description: 'Synthetic',
    });
    expect(s1.lock_version).toBe(2);
    await expectError(m.tl.updateTemplateDraft(admin2A, t.id, { kind: 'inspection', versionId: t.version_id, lockVersion: 1, title: 'Stale', items: [] }),
      'AssuranceConflictError', /Someone else saved this draft/);
    const d = await m.tl.getAssuranceTemplate(adminA, 'inspection', t.id);
    expect(d!.template).toMatchObject({ name: '[TEST] Lock (renamed)', template_type: 'SAFETY', description: 'Synthetic' });
    expect(d!.draft).toMatchObject({ title: 'Lock v1', lock_version: 2 });
    expect(d!.draft!.items.map(i => [i.label, i.section])).toEqual([['Walkways clear', 'Access'], ['Exit signs lit', 'Access'], ['Extinguisher pressure (psi)', 'Fire']]);
  });

  it('publish validation is server-side', async () => {
    const t = await m.tl.createAssuranceTemplate(adminA, { kind: 'inspection', name: '[TEST] Validate', templateType: 'SITE', items: [] });
    await expectError(m.tl.publishTemplateVersion(adminA, t.id, { kind: 'inspection', versionId: t.version_id, lockVersion: 1 }), 'AssuranceValidationError', /at least one/);
    let lock = (await m.tl.updateTemplateDraft(adminA, t.id, { kind: 'inspection', versionId: t.version_id, lockVersion: 1, title: 'V', items: [{ label: 'Pick', responseType: 'CHOICE', options: ['only'] }] })).lock_version;
    await expectError(m.tl.publishTemplateVersion(adminA, t.id, { kind: 'inspection', versionId: t.version_id, lockVersion: lock }), 'AssuranceValidationError', /two options/);
    lock = (await m.tl.updateTemplateDraft(adminA, t.id, { kind: 'inspection', versionId: t.version_id, lockVersion: lock, title: 'V',
      items: [{ label: 'A', section: 'S1' }, { label: 'B', section: 'S2' }, { label: 'C', section: 'S1' }] })).lock_version;
    await expectError(m.tl.publishTemplateVersion(adminA, t.id, { kind: 'inspection', versionId: t.version_id, lockVersion: lock }), 'AssuranceValidationError', /split/);
    lock = (await m.tl.updateTemplateDraft(adminA, t.id, { kind: 'inspection', versionId: t.version_id, lockVersion: lock, title: 'V', items: [{ label: 'Same' }, { label: 'same' }] })).lock_version;
    await expectError(m.tl.publishTemplateVersion(adminA, t.id, { kind: 'inspection', versionId: t.version_id, lockVersion: lock }), 'AssuranceValidationError', /repeats/);
    lock = (await m.tl.updateTemplateDraft(adminA, t.id, { kind: 'inspection', versionId: t.version_id, lockVersion: lock, title: 'V', items: [{ label: 'Fine' }] })).lock_version;
    // Publishing content the caller has not seen (stale lock) is refused.
    await expectError(m.tl.publishTemplateVersion(adminA, t.id, { kind: 'inspection', versionId: t.version_id, lockVersion: lock - 1 }), 'AssuranceConflictError');
    expect((await m.tl.publishTemplateVersion(adminA, t.id, { kind: 'inspection', versionId: t.version_id, lockVersion: lock })).version_number).toBe(1);
    // Published content can no longer be saved, and identity is now fixed.
    await expectError(m.tl.updateTemplateDraft(adminA, t.id, { kind: 'inspection', versionId: t.version_id, lockVersion: lock + 1, title: 'X', items: [] }),
      'AssuranceConflictError', /published/);
  });
});

describe('core historical-integrity proof', () => {
  it('inspection: v1 published → record from v1 → v2 published → old record still v1, new record uses v2', async () => {
    const t = await m.tl.createAssuranceTemplate(adminA, { kind: 'inspection', name: '[TEST] Depot walk', templateType: 'SITE', items: INSPECTION_ITEMS });
    await m.tl.publishTemplateVersion(adminA, t.id, { kind: 'inspection', versionId: t.version_id, lockVersion: 1 });
    expect((await m.tl.listPublishedTemplateOptions(mgrA, 'inspection')).find(o => o.template_id === t.id)).toMatchObject({ version_id: t.version_id, version_number: 1, item_count: 3 });

    const r1 = await m.inspections.createInspection(mgrA, { title: '[TEST] Walk on v1', templateVersionId: t.version_id });
    await m.inspections.startInspection(mgrA, r1.id);
    const keys1 = (await m.inspections.getInspectionDetail(mgrA, r1.id))!.checklist.map(i => i.key);
    await m.inspections.recordInspectionResponse(mgrA, r1.id, { itemKey: keys1[0], outcome: 'FAIL', notes: 'Pallet in walkway' });

    // An admin creates v2 (a copy), rewords it, adds a section and publishes it.
    const v2 = await m.tl.createTemplateVersion(adminA, t.id, { kind: 'inspection' });
    expect(v2.version_number).toBe(2);
    await expectError(m.tl.createTemplateVersion(adminA, t.id, { kind: 'inspection' }), 'AssuranceConflictError', /already a draft/);
    const v2Draft = (await m.tl.getAssuranceTemplate(adminA, 'inspection', t.id))!.draft!;
    expect(v2Draft.items.map(i => i.label)).toEqual(INSPECTION_ITEMS.map(i => i.label)); // copied from v1
    // Identity is fixed once published (identity fields on a v2 save are refused).
    await expectError(m.tl.updateTemplateDraft(adminA, t.id, { kind: 'inspection', versionId: v2.id, lockVersion: 1, title: 'x', items: [], name: 'Renamed', templateType: 'SITE' }),
      'AssuranceConflictError', /fixed once/);
    const saved = await m.tl.updateTemplateDraft(adminA, t.id, {
      kind: 'inspection', versionId: v2.id, lockVersion: 1, title: '[TEST] Depot walk rev 2',
      items: [{ label: 'Walkways and exits clear', section: 'Access' }, { label: 'Spill kit stocked', section: 'Environment' }],
    });
    // Until v2 is published, selectors still offer v1 only.
    expect((await m.tl.listPublishedTemplateOptions(mgrA, 'inspection')).filter(o => o.template_id === t.id).map(o => o.version_number)).toEqual([1]);
    const pub = await m.tl.publishTemplateVersion(adminA, t.id, { kind: 'inspection', versionId: v2.id, lockVersion: saved.lock_version });
    expect(pub).toMatchObject({ version_number: 2, superseded_version_number: 1 });
    expect(await versionRow('inspection', t.version_id)).toMatchObject({ status: 'RETIRED', retired_by: 'tp-a-admin' });
    expect(await versionRow('inspection', v2.id)).toMatchObject({ status: 'PUBLISHED', published_by: 'tp-a-admin' });

    // The old record still renders v1's exact wording.
    const d1 = await m.inspections.getInspectionDetail(mgrA, r1.id);
    expect(d1!.inspection).toMatchObject({ template_version_id: t.version_id, template_version_number: 1, latest_template_version_number: 2 });
    expect(d1!.checklist.map(i => i.label)).toEqual(INSPECTION_ITEMS.map(i => i.label));
    expect(d1!.checklist.map(i => i.section)).toEqual(['Access', 'Access', 'Fire']);
    expect(d1!.responses[0]).toMatchObject({ item_label: 'Walkways clear', outcome: 'FAIL' });
    // ...and can still be worked: responses against v1 keys, and an explicit finding from a v1 item.
    await m.inspections.recordInspectionResponse(mgrA, r1.id, { itemKey: keys1[1], outcome: 'PASS' });
    const f = await m.findings.createFinding(mgrA, { findingType: 'HAZARD', title: '[TEST] Walkway blocked', description: 'Synthetic.', inspectionId: r1.id, inspectionItemKey: keys1[0] });
    expect(f.id).toBeTruthy();
    expect((await m.inspections.getInspectionDetail(mgrA, r1.id))!.findings.map(x => x.source_item_key)).toEqual([keys1[0]]);

    // A new record binds to v2; v1 is no longer offered or bindable.
    expect((await m.tl.listPublishedTemplateOptions(mgrA, 'inspection')).filter(o => o.template_id === t.id).map(o => o.version_id)).toEqual([v2.id]);
    await expectError(m.inspections.createInspection(mgrA, { title: 'x', templateVersionId: t.version_id }), 'AssuranceValidationError', /not published/);
    const r2 = await m.inspections.createInspection(mgrA, { title: '[TEST] Walk on v2', templateVersionId: v2.id });
    const d2 = await m.inspections.getInspectionDetail(mgrA, r2.id);
    expect(d2!.inspection.template_version_number).toBe(2);
    expect(d2!.checklist.map(i => [i.label, i.section])).toEqual([['Walkways and exits clear', 'Access'], ['Spill kit stocked', 'Environment']]);

    const detail = await m.tl.getAssuranceTemplate(viewerA, 'inspection', t.id);
    expect(detail!.versions.map(v => [v.version_number, v.status, v.record_count])).toEqual([[2, 'PUBLISHED', 1], [1, 'RETIRED', 1]]);
  });

  it('audit: the same proof, including the version standard reference', async () => {
    const t = await m.tl.createAssuranceTemplate(adminA, {
      kind: 'audit', name: '[TEST] Waste ops', templateType: 'INTERNAL', standardReference: 'Synthetic Procedure v1',
      items: [{ label: 'Route sheets completed', section: 'Records' }, { label: 'Pre-start checks recorded', section: 'Vehicles' }],
    });
    await m.tl.publishTemplateVersion(adminA, t.id, { kind: 'audit', versionId: t.version_id, lockVersion: 1 });
    const a1 = await m.audits.createAudit(mgrA, { title: '[TEST] Audit on v1', scope: 'Depot', templateVersionId: t.version_id });
    const v2 = await m.tl.createTemplateVersion(adminA, t.id, { kind: 'audit' });
    const saved = await m.tl.updateTemplateDraft(adminA, t.id, { kind: 'audit', versionId: v2.id, lockVersion: 1, title: '[TEST] Waste ops rev 2', standardReference: 'Synthetic Procedure v2', items: [{ label: 'Only criterion in v2' }] });
    await m.tl.publishTemplateVersion(adminA, t.id, { kind: 'audit', versionId: v2.id, lockVersion: saved.lock_version });
    const d1 = await m.audits.getAuditDetail(mgrA, a1.id);
    expect(d1!.audit).toMatchObject({ template_version_number: 1, latest_template_version_number: 2, standard_reference: 'Synthetic Procedure v1' });
    expect(d1!.criteria.map(c => [c.label, c.section])).toEqual([['Route sheets completed', 'Records'], ['Pre-start checks recorded', 'Vehicles']]);
    await expectError(m.audits.createAudit(mgrA, { title: 'x', scope: 's', templateVersionId: t.version_id }), 'AssuranceValidationError', /not published/);
    const a2 = await m.audits.createAudit(mgrA, { title: '[TEST] Audit on v2', scope: 'Depot', templateVersionId: v2.id });
    const d2 = await m.audits.getAuditDetail(mgrA, a2.id);
    expect(d2!.audit).toMatchObject({ template_version_number: 2, standard_reference: 'Synthetic Procedure v2' });
    expect(d2!.criteria.map(c => c.label)).toEqual(['Only criterion in v2']);
  });

  it('completion never creates findings automatically', async () => {
    const t = await m.tl.createAssuranceTemplate(adminA, { kind: 'inspection', name: '[TEST] No auto findings', templateType: 'SITE', items: [{ label: 'Only item' }] });
    await m.tl.publishTemplateVersion(adminA, t.id, { kind: 'inspection', versionId: t.version_id, lockVersion: 1 });
    const r = await m.inspections.createInspection(mgrA, { title: '[TEST] Fail without finding', templateVersionId: t.version_id });
    await m.inspections.startInspection(mgrA, r.id);
    const key = (await m.inspections.getInspectionDetail(mgrA, r.id))!.checklist[0].key;
    await m.inspections.recordInspectionResponse(mgrA, r.id, { itemKey: key, outcome: 'FAIL', notes: 'Broken' });
    await m.inspections.completeInspection(mgrA, r.id, {});
    expect((await m.inspections.getInspectionDetail(mgrA, r.id))!.findings).toEqual([]);
  });
});

describe('retire', () => {
  it('retiring removes the template from selectors only; a later version brings it back', async () => {
    const t = await m.tl.createAssuranceTemplate(adminA, { kind: 'inspection', name: '[TEST] Retire me', templateType: 'SITE', items: [{ label: 'X' }] });
    await expectError(m.tl.retireAssuranceTemplate(adminA, t.id, { kind: 'inspection' }), 'AssuranceConflictError', /Only a published/);
    await m.tl.publishTemplateVersion(adminA, t.id, { kind: 'inspection', versionId: t.version_id, lockVersion: 1 });
    const r = await m.inspections.createInspection(mgrA, { title: '[TEST] Before retire', templateVersionId: t.version_id });
    expect(await m.tl.retireAssuranceTemplate(adminA, t.id, { kind: 'inspection' })).toEqual({ version_number: 1 });
    const d = await m.tl.getAssuranceTemplate(adminA, 'inspection', t.id);
    expect(d!.template).toMatchObject({ status: 'RETIRED', is_active: false });
    expect((await m.tl.listPublishedTemplateOptions(mgrA, 'inspection')).some(o => o.template_id === t.id)).toBe(false);
    await expectError(m.inspections.createInspection(mgrA, { title: 'x', templateVersionId: t.version_id }), 'AssuranceValidationError', /not published/);
    expect((await m.inspections.getInspectionDetail(mgrA, r.id))!.inspection.template_version_id).toBe(t.version_id);
    expect((await m.tl.listAssuranceTemplates(adminA, { status: 'RETIRED' })).some(x => x.id === t.id)).toBe(true);
    // Revival: a new version from the retired one, published, makes it available again.
    const v2 = await m.tl.createTemplateVersion(adminA, t.id, { kind: 'inspection' });
    await m.tl.publishTemplateVersion(adminA, t.id, { kind: 'inspection', versionId: v2.id, lockVersion: 1 });
    expect((await m.tl.getAssuranceTemplate(adminA, 'inspection', t.id))!.template.status).toBe('PUBLISHED');
    expect((await m.tl.listPublishedTemplateOptions(mgrA, 'inspection')).find(o => o.template_id === t.id)!.version_id).toBe(v2.id);
  });
});

describe('permissions and tenant isolation', () => {
  it('viewers and managers can read but not create, edit, version, publish or retire', async () => {
    const t = await m.tl.createAssuranceTemplate(adminA, { kind: 'audit', name: '[TEST] Perms', templateType: 'SITE', standardReference: 'Std', items: [{ label: 'C' }] });
    for (const who of [viewerA, mgrA]) {
      expect((await m.tl.getAssuranceTemplate(who, 'audit', t.id))!.template.name).toBe('[TEST] Perms');
      expect((await m.tl.listAssuranceTemplates(who)).some(x => x.id === t.id)).toBe(true);
      await expectError(m.tl.createAssuranceTemplate(who, { kind: 'audit', name: 'x', templateType: 'SITE', items: [] }), 'AssuranceForbiddenError');
      await expectError(m.tl.updateTemplateDraft(who, t.id, { kind: 'audit', versionId: t.version_id, lockVersion: 1, title: 'x', items: [] }), 'AssuranceForbiddenError');
      await expectError(m.tl.publishTemplateVersion(who, t.id, { kind: 'audit', versionId: t.version_id, lockVersion: 1 }), 'AssuranceForbiddenError');
      await expectError(m.tl.createTemplateVersion(who, t.id, { kind: 'audit' }), 'AssuranceForbiddenError');
      await expectError(m.tl.retireAssuranceTemplate(who, t.id, { kind: 'audit' }), 'AssuranceForbiddenError');
    }
    expect((await versionRow('audit', t.version_id))).toMatchObject({ status: 'DRAFT', lock_version: 1 });
  });

  it("another organisation cannot see, change, publish, retire or use a template", async () => {
    const t = await m.tl.createAssuranceTemplate(adminA, { kind: 'inspection', name: '[TEST] Org A only', templateType: 'SITE', items: [{ label: 'A' }] });
    expect(await m.tl.getAssuranceTemplate(adminB, 'inspection', t.id)).toBeNull();
    expect((await m.tl.listAssuranceTemplates(adminB)).some(x => x.id === t.id)).toBe(false);
    await expectError(m.tl.updateTemplateDraft(adminB, t.id, { kind: 'inspection', versionId: t.version_id, lockVersion: 1, title: 'hijack', items: [] }), 'AssuranceNotFoundError');
    await expectError(m.tl.publishTemplateVersion(adminB, t.id, { kind: 'inspection', versionId: t.version_id, lockVersion: 1 }), 'AssuranceNotFoundError');
    await expectError(m.tl.createTemplateVersion(adminB, t.id, { kind: 'inspection' }), 'AssuranceNotFoundError');
    await expectError(m.tl.retireAssuranceTemplate(adminB, t.id, { kind: 'inspection' }), 'AssuranceNotFoundError');
    await m.tl.publishTemplateVersion(adminA, t.id, { kind: 'inspection', versionId: t.version_id, lockVersion: 1 });
    expect((await m.tl.listPublishedTemplateOptions(mgrB, 'inspection')).some(o => o.template_id === t.id)).toBe(false);
    await expectError(m.inspections.createInspection(mgrB, { title: 'x', templateVersionId: t.version_id }), 'AssuranceValidationError', /Template/);
    expect(await sqlState(sql`INSERT INTO assurance_inspections (organisation_id, inspection_reference, template_version_id, inspection_type, title)
      VALUES ('tp-org-b', 'INS-TP-RAW2', ${t.version_id}::uuid, 'SITE', 'raw')`)).not.toBe('OK');
    // Mass-assignment probe: organisation in the body is ignored.
    const own = await m.tl.createAssuranceTemplate(adminA, { kind: 'inspection', name: '[TEST] Probe', templateType: 'SITE', items: [], organisationId: 'tp-org-b', organisation_id: 'tp-org-b' });
    const [row] = await sql`SELECT organisation_id, is_active FROM assurance_inspection_templates WHERE id = ${own.id}::uuid` as { organisation_id: string; is_active: boolean }[];
    expect(row).toEqual({ organisation_id: 'tp-org-a', is_active: false });
  });
});

describe('audit events', () => {
  it('created / updated / published / version_created / retired, in the same transaction, identifiers only', async () => {
    const t = await m.tl.createAssuranceTemplate(adminA, { kind: 'inspection', name: '[TEST] Audited', templateType: 'SITE', items: [{ label: 'Secret wording one' }] });
    const s = await m.tl.updateTemplateDraft(adminA, t.id, { kind: 'inspection', versionId: t.version_id, lockVersion: 1, title: 'v1', items: [{ label: 'Secret wording two' }] });
    await m.tl.publishTemplateVersion(adminA, t.id, { kind: 'inspection', versionId: t.version_id, lockVersion: s.lock_version });
    const v2 = await m.tl.createTemplateVersion(admin2A, t.id, { kind: 'inspection' });
    await m.tl.publishTemplateVersion(admin2A, t.id, { kind: 'inspection', versionId: v2.id, lockVersion: 1 });
    await m.tl.retireAssuranceTemplate(adminA, t.id, { kind: 'inspection' });
    const rows = await auditRows(t.id);
    expect(rows.map(r => [r.action, r.user_id])).toEqual([
      ['assurance_inspection_template.created', 'tp-a-admin'],
      ['assurance_inspection_template.updated', 'tp-a-admin'],
      ['assurance_inspection_template.published', 'tp-a-admin'],
      ['assurance_inspection_template.version_created', 'tp-a-admin2'],
      ['assurance_inspection_template.published', 'tp-a-admin2'],
      ['assurance_inspection_template.retired', 'tp-a-admin'],
    ]);
    expect(rows[2].after_state).toMatchObject({ version_number: 1, status: 'PUBLISHED', superseded_version_number: null });
    expect(rows[3].after_state).toMatchObject({ version_number: 2, status: 'DRAFT', copied_from_version_number: 1 });
    expect(rows[4].after_state).toMatchObject({ version_number: 2, superseded_version_number: 1 });
    expect(rows[5].after_state).toMatchObject({ version_number: 2, status: 'RETIRED' });
    expect(JSON.stringify(rows)).not.toMatch(/Secret wording|\[TEST\] Audited/);
  });

  it('a failed audit write rolls back the lifecycle change (atomic)', async () => {
    const t = await m.tl.createAssuranceTemplate(adminA, { kind: 'inspection', name: '[TEST] Atomic', templateType: 'SITE', items: [{ label: 'A' }] });
    await sql.raw(`
      CREATE OR REPLACE FUNCTION tp_fail_publish_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'assurance_inspection_template.published' AND NEW.resource_id = '${t.id}' THEN
          RAISE EXCEPTION 'synthetic audit failure';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER tp_fail_publish_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION tp_fail_publish_audit();
    `);
    try {
      let failed = false;
      try { await m.tl.publishTemplateVersion(adminA, t.id, { kind: 'inspection', versionId: t.version_id, lockVersion: 1 }); } catch { failed = true; }
      expect(failed).toBe(true);
      expect(await versionRow('inspection', t.version_id)).toMatchObject({ status: 'DRAFT', lock_version: 1, published_at: null });
      expect((await m.tl.getAssuranceTemplate(adminA, 'inspection', t.id))!.template.is_active).toBe(false);
    } finally {
      await sql.raw('DROP TRIGGER tp_fail_publish_audit ON audit_logs; DROP FUNCTION tp_fail_publish_audit();');
    }
    await m.tl.publishTemplateVersion(adminA, t.id, { kind: 'inspection', versionId: t.version_id, lockVersion: 1 });
    expect((await versionRow('inspection', t.version_id)).status).toBe('PUBLISHED');
  });
});

describe('concurrency', () => {
  it('two admins publishing the same draft: exactly one wins', async () => {
    const t = await m.tl.createAssuranceTemplate(adminA, { kind: 'inspection', name: '[TEST] Race publish', templateType: 'SITE', items: [{ label: 'A' }] });
    const results = await Promise.allSettled([
      m.tl.publishTemplateVersion(adminA, t.id, { kind: 'inspection', versionId: t.version_id, lockVersion: 1 }),
      m.tl.publishTemplateVersion(admin2A, t.id, { kind: 'inspection', versionId: t.version_id, lockVersion: 1 }),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.name).toBe('AssuranceConflictError');
    expect((await auditRows(t.id)).filter(r => r.action.endsWith('.published'))).toHaveLength(1);
  });

  it('two saves of the same draft revision: exactly one wins, no lost update', async () => {
    const t = await m.tl.createAssuranceTemplate(adminA, { kind: 'audit', name: '[TEST] Race save', templateType: 'SITE', standardReference: 'Std', items: [{ label: 'A' }] });
    const results = await Promise.allSettled([
      m.tl.updateTemplateDraft(adminA, t.id, { kind: 'audit', versionId: t.version_id, lockVersion: 1, title: 'From Ada', items: [{ label: 'Ada' }] }),
      m.tl.updateTemplateDraft(admin2A, t.id, { kind: 'audit', versionId: t.version_id, lockVersion: 1, title: 'From Abe', items: [{ label: 'Abe' }] }),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const d = await m.tl.getAssuranceTemplate(adminA, 'audit', t.id);
    expect(d!.draft!.lock_version).toBe(2);
    const winner = results[0].status === 'fulfilled' ? 'Ada' : 'Abe';
    expect(d!.draft!.items.map(i => i.label)).toEqual([winner]);
  });

  it('two "create new version" requests: exactly one draft', async () => {
    const t = await m.tl.createAssuranceTemplate(adminA, { kind: 'inspection', name: '[TEST] Race version', templateType: 'SITE', items: [{ label: 'A' }] });
    await m.tl.publishTemplateVersion(adminA, t.id, { kind: 'inspection', versionId: t.version_id, lockVersion: 1 });
    const results = await Promise.allSettled([
      m.tl.createTemplateVersion(adminA, t.id, { kind: 'inspection' }),
      m.tl.createTemplateVersion(admin2A, t.id, { kind: 'inspection' }),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await m.tl.getAssuranceTemplate(adminA, 'inspection', t.id))!.versions.filter(v => v.status === 'DRAFT')).toHaveLength(1);
  });

  it('retire racing record creation: a record never binds to a retired version', async () => {
    for (let i = 0; i < 5; i++) {
      const t = await m.tl.createAssuranceTemplate(adminA, { kind: 'inspection', name: `[TEST] Race retire ${i}`, templateType: 'SITE', items: [{ label: 'A' }] });
      await m.tl.publishTemplateVersion(adminA, t.id, { kind: 'inspection', versionId: t.version_id, lockVersion: 1 });
      const [created, retired] = await Promise.allSettled([
        m.inspections.createInspection(mgrA, { title: `[TEST] Race ${i}`, templateVersionId: t.version_id }),
        m.tl.retireAssuranceTemplate(adminA, t.id, { kind: 'inspection' }),
      ]);
      expect(retired.status).toBe('fulfilled');
      if (created.status === 'rejected') {
        expect(['AssuranceValidationError', 'AssuranceConflictError']).toContain((created.reason as Error).name);
      } else {
        // The create held its FOR SHARE lock on the PUBLISHED version first; the
        // retire waited for it, and the record keeps that version.
        expect((await m.inspections.getInspectionDetail(mgrA, created.value.id))!.inspection.template_version_id).toBe(t.version_id);
      }
    }
  });
});

describe('listing', () => {
  it('lists both kinds with derived status and filters', async () => {
    const all = await m.tl.listAssuranceTemplates(adminA);
    expect(all.some(t => t.kind === 'inspection')).toBe(true);
    expect(all.some(t => t.kind === 'audit')).toBe(true);
    expect((await m.tl.listAssuranceTemplates(adminA, { kind: 'audit' })).every(t => t.kind === 'audit')).toBe(true);
    expect((await m.tl.listAssuranceTemplates(adminA, { status: 'DRAFT' })).every(t => t.status === 'DRAFT' && t.published_version_id === null)).toBe(true);
    expect(await m.tl.listAssuranceTemplates(V('tp-org-empty', 'nobody', 'admin'))).toEqual([]);
  });
});
