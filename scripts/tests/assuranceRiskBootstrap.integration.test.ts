// BrainBase Assurance — Brainbase risk-level bootstrap: application regression.
// Run ONLY via scripts/tests/verify-assurance-risk-bootstrap.sh, which applies
// the real Assurance migrations to a disposable postgres:17, runs
// scripts/seed-assurance-risk-levels-brainbase.sql, and only then starts this
// suite. Proves the UNCHANGED application code behaves as documented on top
// of the seeded scale: ordering, the dashboard "serious" threshold, incident
// risk selection, inactive levels and tenant isolation.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createNeonCompatibleSql } from './helpers/neonCompatiblePgSql';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('assuranceRiskBootstrap.integration.test.ts requires DATABASE_URL (see verify-assurance-risk-bootstrap.sh).');
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com|vercel/i.test(DATABASE_URL)) {
  throw new Error('Refusing to run against a hosted database. Disposable local Postgres only.');
}
if (!/^(localhost|127\.0\.0\.1)$/.test(new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname)) {
  throw new Error('Refusing to run against a non-localhost DATABASE_URL host.');
}

const sql = createNeonCompatibleSql(DATABASE_URL);
vi.doMock('@/lib/db', () => ({ default: sql }));

type Mods = {
  incidents: typeof import('@/lib/assurance/incidents');
  dashboard: typeof import('@/lib/assurance/dashboard');
  lookups: typeof import('@/lib/assurance/lookups');
};
let m: Mods;

import type { AssuranceViewer } from '@/lib/assurance/policy';
const BRAINBASE = '1732569e-6350-495e-aa6a-7218ce7bf749';
const OTHER = 'risk-other-org';
const mgrBB: AssuranceViewer = { organisationId: BRAINBASE, userId: 'bb-mgr', role: 'manager', canViewAllRestricted: false };
const adminBB: AssuranceViewer = { organisationId: BRAINBASE, userId: 'bb-admin', role: 'admin', canViewAllRestricted: true };

let risk: Record<string, string> = {};
let OTHER_RISK = '';
let INACTIVE_RISK = '';

const past = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();
const incidentInput = (riskLevelId: string | undefined, title: string) => ({
  title, description: 'Risk bootstrap regression incident.', category: 'OPERATIONAL_SERVICE', occurredAt: past(1), riskLevelId,
});

async function expectValidation(p: Promise<unknown>, msg: RegExp) {
  let caught: unknown;
  try { await p; } catch (e) { caught = e; }
  expect(caught, 'expected AssuranceValidationError').toBeTruthy();
  expect((caught as Error).name).toBe('AssuranceValidationError');
  expect((caught as Error).message).toMatch(msg);
}

beforeAll(async () => {
  // The harness has already seeded Brainbase's scale; confirm we start from it.
  const rows = await sql`SELECT code, id FROM assurance_risk_levels WHERE organisation_id = ${BRAINBASE}` as { code: string; id: string }[];
  expect(rows.map(r => r.code).sort()).toEqual(['EXTREME', 'HIGH', 'LOW', 'MEDIUM']);
  risk = Object.fromEntries(rows.map(r => [r.code, r.id]));
  OTHER_RISK = (await sql`SELECT id FROM assurance_risk_levels WHERE organisation_id = ${OTHER} AND code = 'HIGH'` as { id: string }[])[0].id;

  m = {
    incidents: await import('@/lib/assurance/incidents'),
    dashboard: await import('@/lib/assurance/dashboard'),
    lookups: await import('@/lib/assurance/lookups'),
  };
});

afterAll(async () => { await sql.end(); });

describe('seeded Brainbase risk scale through the unchanged application code', () => {
  it('lists the active levels Extreme, High, Medium, Low (rank DESC)', async () => {
    const levels = await m.lookups.listRiskLevels(BRAINBASE);
    expect(levels.map(l => [l.code, l.name, l.rank, l.requires_verification])).toEqual([
      ['EXTREME', 'Extreme', 40, true],
      ['HIGH', 'High', 30, true],
      ['MEDIUM', 'Medium', 20, false],
      ['LOW', 'Low', 10, false],
    ]);
  });

  it('never lists another organisation’s levels', async () => {
    const levels = await m.lookups.listRiskLevels(BRAINBASE);
    expect(levels.map(l => l.id)).not.toContain(OTHER_RISK);
  });

  it('an incident can be created at each active level (and with no level)', async () => {
    for (const code of ['LOW', 'MEDIUM', 'HIGH', 'EXTREME']) {
      const { id } = await m.incidents.createIncident(mgrBB, incidentInput(risk[code], `Regression ${code}`));
      const [row] = await sql`SELECT risk_level_id FROM assurance_incidents WHERE id = ${id}::uuid` as { risk_level_id: string }[];
      expect(row.risk_level_id).toBe(risk[code]);
    }
    const { id } = await m.incidents.createIncident(mgrBB, incidentInput(undefined, 'Regression no risk'));
    const [row] = await sql`SELECT risk_level_id FROM assurance_incidents WHERE id = ${id}::uuid` as { risk_level_id: string | null }[];
    expect(row.risk_level_id).toBeNull();
  });

  it('dashboard "serious" resolves to High + Extreme (two highest active ranks)', async () => {
    const d = await m.dashboard.getDashboardData(adminBB);
    expect(d.counts.open_incidents).toBe(5);
    expect(d.counts.serious_open_incidents).toBe(2);
    expect(d.seriousIncidents.map(i => i.detail)).toEqual(['Extreme', 'High']);
  });

  it('a supplied cross-organisation risk level is rejected (no FK leak, nothing written)', async () => {
    const before = await sql`SELECT count(*)::int AS n FROM assurance_incidents` as { n: number }[];
    await expectValidation(m.incidents.createIncident(mgrBB, incidentInput(OTHER_RISK, 'Cross-org risk')), /Risk level/);
    const after = await sql`SELECT count(*)::int AS n FROM assurance_incidents` as { n: number }[];
    expect(after[0].n).toBe(before[0].n);
  });

  describe('an inactive level', () => {
    beforeAll(async () => {
      const [r] = await sql`
        INSERT INTO assurance_risk_levels (organisation_id, code, name, rank, is_active)
        VALUES (${BRAINBASE}, 'RETIRED', 'Retired (inactive)', 50, false) RETURNING id` as { id: string }[];
      INACTIVE_RISK = r.id;
    });
    afterAll(async () => {
      await sql`DELETE FROM assurance_risk_levels WHERE id = ${INACTIVE_RISK}::uuid`;
    });

    it('is not offered', async () => {
      const levels = await m.lookups.listRiskLevels(BRAINBASE);
      expect(levels.map(l => l.code)).toEqual(['EXTREME', 'HIGH', 'MEDIUM', 'LOW']);
    });

    it('is refused when supplied', async () => {
      await expectValidation(m.incidents.createIncident(mgrBB, incidentInput(INACTIVE_RISK, 'Inactive risk')), /Risk level/);
    });

    it('does not move the serious threshold (still High + Extreme)', async () => {
      const d = await m.dashboard.getDashboardData(adminBB);
      expect(d.counts.serious_open_incidents).toBe(2);
      expect(d.seriousIncidents.map(i => i.detail)).toEqual(['Extreme', 'High']);
    });
  });
});
