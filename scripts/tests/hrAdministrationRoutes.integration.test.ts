import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { NextRequest, NextResponse } from 'next/server';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname)) {
  throw new Error('Administration proof requires disposable loopback Postgres.');
}
const pool = new Pool({ connectionString: databaseUrl });
const org = 'admin-route-proof', otherOrg = 'admin-route-other';
let session = { organisationId: org, userId: 'proof-hr', role: 'viewer' };
let authenticated = true;
let pauseCapability: (() => Promise<void>) | null = null;
vi.doMock('@/lib/db', () => ({ default: async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.reduce((result, part, index) => result + (index ? `$${index}` : '') + part, '');
  return (await pool.query(text, values)).rows;
} }));
vi.doMock('@/lib/org', () => ({
  requireSession: async () => { if (!authenticated) throw new Error('Unauthenticated'); return session; },
  unauthorized: () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  forbidden: () => NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
}));
// Module enablement and login are fixtures; HR context, validation, routes and audit SQL are real.
vi.doMock('@/lib/hr/capability', () => ({ requireHrCapability: async () => { await pauseCapability?.(); } }));
let administrators: typeof import('@/app/api/hr/administrators/route');
let teams: typeof import('@/app/api/hr/teams/route');
let team: typeof import('@/app/api/hr/teams/[id]/route');
let archive: typeof import('@/app/api/hr/teams/[id]/archive/route');
let restore: typeof import('@/app/api/hr/teams/[id]/restore/route');
const teamId = '91111111-1111-4111-8111-111111111111';
const foreignTeam = '92222222-2222-4222-8222-222222222222';
const foreignPerson = '93333333-3333-4333-8333-333333333333';
const request = (path: string, method: string, body?: unknown) => new NextRequest(`http://fixture.local/api/hr/${path}`, {
  method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
});
const params = (id = teamId) => ({ params: Promise.resolve({ id }) });
const q = async (text: string, values: unknown[] = []) => (await pool.query(text, values)).rows;
const snapshot = async () => ({
  teams: await q('SELECT * FROM hr_teams WHERE organisation_id IN ($1,$2) ORDER BY id', [org, otherOrg]),
  grants: await q('SELECT * FROM hr_administrators WHERE organisation_id IN ($1,$2) ORDER BY organisation_id,user_id', [org, otherOrg]),
  audits: await q('SELECT * FROM audit_logs WHERE organisation_id IN ($1,$2) ORDER BY id', [org, otherOrg]),
});
beforeAll(async () => {
  await q("ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE', ADD COLUMN IF NOT EXISTS email TEXT");
  await q('ALTER TABLE hr_administrators ADD COLUMN IF NOT EXISTS id TEXT NOT NULL DEFAULT gen_random_uuid()::text, ADD COLUMN IF NOT EXISTS created_by TEXT REFERENCES users(id)');
  await q(`CREATE TABLE IF NOT EXISTS hr_teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id TEXT NOT NULL REFERENCES organisations(id),
    name TEXT NOT NULL, description TEXT, manager_person_id UUID REFERENCES hr_people(id), archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  administrators = await import('@/app/api/hr/administrators/route');
  teams = await import('@/app/api/hr/teams/route');
  team = await import('@/app/api/hr/teams/[id]/route');
  archive = await import('@/app/api/hr/teams/[id]/archive/route');
  restore = await import('@/app/api/hr/teams/[id]/restore/route');
});
beforeEach(async () => {
  authenticated = true; pauseCapability = null; session = { organisationId: org, userId: 'proof-hr', role: 'viewer' };
  await q('INSERT INTO organisations(id,name,slug) VALUES ($1,$1,$1),($2,$2,$2) ON CONFLICT DO NOTHING', [org, otherOrg]);
  await q(`INSERT INTO users(id,organisation_id,username,name,status) VALUES
    ('proof-hr',$1,'proof-hr','HR','ACTIVE'),('proof-candidate',$1,'proof-candidate','Candidate','ACTIVE'),
    ('proof-inactive',$1,'proof-inactive','Inactive','INACTIVE'),('proof-foreign',$2,'proof-foreign','Foreign','ACTIVE') ON CONFLICT DO NOTHING`, [org, otherOrg]);
  await q('DELETE FROM audit_logs WHERE organisation_id IN ($1,$2)', [org, otherOrg]);
  await q('DELETE FROM hr_administrators WHERE organisation_id IN ($1,$2)', [org, otherOrg]);
  await q('INSERT INTO hr_administrators(organisation_id,user_id) VALUES ($1,$2)', [org, 'proof-hr']);
  await q('DELETE FROM hr_teams WHERE organisation_id IN ($1,$2)', [org, otherOrg]);
  await q('INSERT INTO hr_people(id,organisation_id,first_name,last_name) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [foreignPerson, otherOrg, 'Foreign', 'Person']);
  await q('INSERT INTO hr_teams(id,organisation_id,name) VALUES ($1,$2,$3),($4,$5,$6)', [teamId, org, 'Delivery', foreignTeam, otherOrg, 'Foreign team']);
});
afterAll(async () => { await pool.end(); });
const actions = ['create', 'edit', 'archive', 'restore', 'grant', 'revoke'] as const;
async function perform(action: typeof actions[number]) {
  if (action === 'create') return teams.POST(request('teams', 'POST', { name: 'Created' }));
  if (action === 'edit') return team.PATCH(request(`teams/${teamId}`, 'PATCH', { name: 'Edited' }), params());
  if (action === 'archive') return archive.POST(request(`teams/${teamId}/archive`, 'POST'), params());
  if (action === 'restore') return restore.POST(request(`teams/${teamId}/restore`, 'POST'), params());
  if (action === 'grant') return administrators.POST(request('administrators', 'POST', { user_id: 'proof-candidate' }));
  return administrators.DELETE(request('administrators?userId=proof-candidate', 'DELETE'));
}
describe('HR administration real routes and Postgres', () => {
  it.each(['grant', 'archive'] as const)('denies pending %s if the grant is revoked before context resolution', async action => {
    let release!: () => void;
    let entered!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    pauseCapability = () => new Promise<void>(resolve => { release = resolve; entered(); });
    const pending = perform(action);
    await reached;
    await q('DELETE FROM hr_administrators WHERE organisation_id=$1 AND user_id=$2', [org, 'proof-hr']);
    const before = await snapshot();
    release(); expect((await pending).status).toBe(403); expect(await snapshot()).toEqual(before);
  });
  it('denies sensitive administrator and archived-Team reads after revocation', async () => {
    await q('DELETE FROM hr_administrators WHERE organisation_id=$1 AND user_id=$2', [org, 'proof-hr']);
    const before = await snapshot();
    expect((await administrators.GET()).status).toBe(403);
    expect((await teams.GET(request('teams?include_archived=1', 'GET'))).status).toBe(403);
    expect(await snapshot()).toEqual(before);
  });
  it('creates, edits, archives and restores a team, then reads the persisted state', async () => {
    expect((await perform('create')).status).toBe(201);
    expect((await perform('edit')).status).toBe(200);
    expect((await perform('archive')).status).toBe(200);
    expect((await team.PATCH(request(`teams/${teamId}`, 'PATCH', { name: 'Invalid archived edit' }), params())).status).toBe(409);
    expect((await perform('restore')).status).toBe(200);
    const rows = await q('SELECT name,archived_at FROM hr_teams WHERE id=$1', [teamId]);
    expect(rows).toEqual([{ name: 'Edited', archived_at: null }]);
    const listed = await teams.GET(request('teams', 'GET'));
    expect((await listed.json()).teams.map((row: { name: string }) => row.name).sort()).toEqual(['Created', 'Edited']);
    expect((await q('SELECT action FROM audit_logs WHERE organisation_id=$1 ORDER BY action', [org])).map(row => row.action))
      .toEqual(['hr_team.archived', 'hr_team.created', 'hr_team.restored', 'hr_team.updated']);
  });
  it('grants/revokes explicitly and avoids duplicate grants or audit rows', async () => {
    expect((await perform('grant')).status).toBe(201);
    const granted = await snapshot();
    expect((await perform('grant')).status).toBe(201); expect(await snapshot()).toEqual(granted);
    const list = await administrators.GET();
    expect((await list.json()).users.find((row: { id: string }) => row.id === 'proof-candidate').is_hr_administrator).toBe(true);
    expect((await perform('revoke')).status).toBe(200);
    expect(await q('SELECT user_id FROM hr_administrators WHERE organisation_id=$1 ORDER BY user_id', [org])).toEqual([{ user_id: 'proof-hr' }]);
    expect((await q('SELECT action FROM audit_logs WHERE organisation_id=$1 ORDER BY action', [org])).map(row => row.action))
      .toEqual(['hr_administrator.granted', 'hr_administrator.revoked']);
  });
  it.each(actions)('denies %s after the caller grant is revoked without business or audit changes', async action => {
    await q('DELETE FROM hr_administrators WHERE organisation_id=$1 AND user_id=$2', [org, 'proof-hr']);
    const before = await snapshot(); expect((await perform(action)).status).toBe(403); expect(await snapshot()).toEqual(before);
  });
  it.each(actions)('denies unauthenticated %s without changes', async action => {
    authenticated = false; const before = await snapshot(); expect((await perform(action)).status).toBe(401); expect(await snapshot()).toEqual(before);
  });
  it.each(['proof-inactive', 'proof-foreign'])('rejects ineligible administrator target %s without changes', async userId => {
    const before = await snapshot(); expect((await administrators.POST(request('administrators', 'POST', { user_id: userId }))).status).toBe(400);
    expect(await snapshot()).toEqual(before);
  });
  it('rejects cross-organisation manager references and team mutations without changes', async () => {
    const before = await snapshot();
    expect((await teams.POST(request('teams', 'POST', { name: 'Bad', manager_person_id: foreignPerson }))).status).toBe(400);
    expect((await team.PATCH(request(`teams/${teamId}`, 'PATCH', { manager_person_id: foreignPerson }), params())).status).toBe(400);
    expect((await team.PATCH(request(`teams/${foreignTeam}`, 'PATCH', { name: 'Bad' }), params(foreignTeam))).status).toBe(404);
    expect((await archive.POST(request(`teams/${foreignTeam}/archive`, 'POST'), params(foreignTeam))).status).toBe(404);
    expect((await restore.POST(request(`teams/${foreignTeam}/restore`, 'POST'), params(foreignTeam))).status).toBe(404);
    expect(await snapshot()).toEqual(before);
  });
});
