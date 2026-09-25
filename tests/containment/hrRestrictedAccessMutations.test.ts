import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NeonDbError } from '@neondatabase/serverless';

type QuerySpec = { text: string; values: unknown[] };

let responses: unknown[] = [];
let callCount = 0;
let calls: QuerySpec[] = [];

const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]): QuerySpec => ({
  text: strings.join('?'),
  values,
}));

const transactionMock = vi.fn(async (
  build: (txn: typeof sqlMock) => QuerySpec[],
) => {
  const queries = build(sqlMock);
  const results: unknown[] = [];
  for (const query of queries) {
    calls.push(query);
    const response = responses[callCount++];
    if (response instanceof Error) throw response;
    results.push(response ?? []);
  }
  return results;
});

vi.mock('@/lib/db', () => ({
  default: Object.assign(
    (...args: [TemplateStringsArray, ...unknown[]]) => sqlMock(...args),
    { transaction: (...args: unknown[]) => transactionMock(...(args as [(txn: typeof sqlMock) => QuerySpec[]])) },
  ),
}));

const {
  grantRestrictedCaseAccess,
  revokeRestrictedCaseAccess,
  isLiveRestrictedGrantUniqueViolation,
} = await import('@/lib/hr/restrictedAccessMutations');

const ACTOR = {
  organisationId: 'org-a',
  userId: 'admin-user',
  ipAddress: '203.0.113.10',
  userAgent: 'vitest',
};
const CASE_ID = '11111111-1111-4111-8111-111111111111';

function queue(...next: unknown[]) {
  responses = [[{ locked: null }], ...next];
  callCount = 0;
}

function neonUnique(constraint: string): NeonDbError {
  const err = new NeonDbError(`duplicate key value violates unique constraint "${constraint}"`);
  err.code = '23505';
  err.constraint = constraint;
  return err;
}

beforeEach(() => {
  responses = [];
  callCount = 0;
  calls = [];
  sqlMock.mockClear();
  transactionMock.mockClear();
  transactionMock.mockImplementation(async (build: (txn: typeof sqlMock) => QuerySpec[]) => {
    const queries = build(sqlMock);
    const results: unknown[] = [];
    for (const query of queries) {
      calls.push(query);
      const response = responses[callCount++];
      if (response instanceof Error) throw response;
      results.push(response ?? []);
    }
    return results;
  });
});

describe('grantRestrictedCaseAccess', () => {
  it('creates the live grant and audit row atomically in one writable-CTE statement', async () => {
    queue([{
      case_exists: true,
      target_eligible: true,
      grant_id: 'grant-1',
      granted_at: '2026-09-25T05:00:00.000Z',
      audit_written: true,
    }]);

    const result = await grantRestrictedCaseAccess({
      actor: ACTOR,
      caseId: CASE_ID,
      targetUserId: 'target-user',
    });

    expect(result).toEqual({
      outcome: 'granted',
      grantId: 'grant-1',
      grantedAt: '2026-09-25T05:00:00.000Z',
    });
    expect(sqlMock).toHaveBeenCalledTimes(2);
    const query = calls[1].text;
    expect(query).toContain('inserted AS (');
    expect(query).toContain('INSERT INTO hr_restricted_case_access');
    expect(query).toContain('INSERT INTO audit_logs');
    expect(query).toContain("'hr_restricted_case_access.granted'");
    expect(query).toContain('jsonb_build_object');
    expect(query).toContain('AND organisation_id = ?');
    expect(calls[1].values).toContain('org-a');
    expect(calls[1].values).toContain('admin-user');
    expect(calls[1].values).toContain('target-user');
  });

  it('is idempotent when a live grant already exists and emits no separate audit query', async () => {
    queue([{ case_exists: true, target_eligible: true, grant_id: null, granted_at: null, audit_written: false }]);

    const result = await grantRestrictedCaseAccess({
      actor: ACTOR,
      caseId: CASE_ID,
      targetUserId: 'target-user',
    });

    expect(result).toEqual({ outcome: 'already_granted' });
    expect(sqlMock).toHaveBeenCalledTimes(2);
    expect(calls[1].text).toContain('existing.revoked_at IS NULL');
  });

  it('regrant-after-revoke creates a fresh INSERT and never resurrects historical rows', async () => {
    queue([{
      case_exists: true,
      target_eligible: true,
      grant_id: 'grant-2',
      granted_at: '2026-09-25T06:00:00.000Z',
      audit_written: true,
    }]);

    await grantRestrictedCaseAccess({ actor: ACTOR, caseId: CASE_ID, targetUserId: 'target-user' });

    const query = calls[1].text;
    expect(query).toContain('INSERT INTO hr_restricted_case_access');
    expect(query).toContain('revoked_at IS NULL');
    expect(query).not.toMatch(/UPDATE\s+hr_restricted_case_access/i);
    expect(query).not.toContain('SET revoked_at = NULL');
  });

  it('reports case_not_found when the active-org case disappeared before the write', async () => {
    queue([{ case_exists: false, target_eligible: true, grant_id: null, granted_at: null, audit_written: false }]);

    const result = await grantRestrictedCaseAccess({ actor: ACTOR, caseId: CASE_ID, targetUserId: 'target-user' });

    expect(result).toEqual({ outcome: 'case_not_found' });
  });

  it('rechecks ACTIVE same-org target eligibility at the write boundary', async () => {
    queue([{ case_exists: true, target_eligible: false, grant_id: null, granted_at: null, audit_written: false }]);

    const result = await grantRestrictedCaseAccess({ actor: ACTOR, caseId: CASE_ID, targetUserId: 'target-user' });

    expect(result).toEqual({ outcome: 'target_not_eligible' });
    expect(calls[1].text).toContain('FROM users');
    expect(calls[1].text).toContain("status = 'ACTIVE'");
    expect(calls[1].text).toContain('organisation_id = ?');
  });

  it('collapses only the named partial-unique live-grant race to already_granted', async () => {
    queue(neonUnique('hr_restricted_case_access_one_live_grant'));

    const result = await grantRestrictedCaseAccess({ actor: ACTOR, caseId: CASE_ID, targetUserId: 'target-user' });

    expect(result).toEqual({ outcome: 'already_granted' });
  });

  it('does not misclassify an unrelated 23505 as an idempotent grant race', async () => {
    const err = neonUnique('some_other_unique_index');
    queue(err);

    await expect(grantRestrictedCaseAccess({
      actor: ACTOR,
      caseId: CASE_ID,
      targetUserId: 'target-user',
    })).rejects.toBe(err);
  });

  it('fails rather than reporting success if a returned mutation lacks its audit row', async () => {
    queue([{
      case_exists: true,
      target_eligible: true,
      grant_id: 'grant-1',
      granted_at: '2026-09-25T05:00:00.000Z',
      audit_written: false,
    }]);

    await expect(grantRestrictedCaseAccess({
      actor: ACTOR,
      caseId: CASE_ID,
      targetUserId: 'target-user',
    })).rejects.toThrow('grant audit was not written');
  });
});

describe('revokeRestrictedCaseAccess', () => {
  it('revokes by UPDATE and writes the revoke audit in the same statement', async () => {
    queue([{
      case_exists: true,
      grant_id: 'grant-1',
      revoked_at: '2026-09-25T07:00:00.000Z',
      audit_written: true,
    }]);

    const result = await revokeRestrictedCaseAccess({
      actor: ACTOR,
      caseId: CASE_ID,
      targetUserId: 'target-user',
    });

    expect(result).toEqual({
      outcome: 'revoked',
      grantId: 'grant-1',
      revokedAt: '2026-09-25T07:00:00.000Z',
    });
    expect(sqlMock).toHaveBeenCalledTimes(2);
    const query = calls[1].text;
    expect(query).toContain('revoked AS (');
    expect(query).toContain('UPDATE hr_restricted_case_access');
    expect(query).toContain('revoked_at = NOW()');
    expect(query).toContain('access.revoked_at IS NULL');
    expect(query).toContain('INSERT INTO audit_logs');
    expect(query).toContain("'hr_restricted_case_access.revoked'");
    expect(query).not.toMatch(/DELETE\s+FROM\s+hr_restricted_case_access/i);
  });

  it('reports case_not_found separately from an idempotent no-live-grant revoke', async () => {
    queue([{ case_exists: false, grant_id: null, revoked_at: null, audit_written: false }]);

    const result = await revokeRestrictedCaseAccess({ actor: ACTOR, caseId: CASE_ID, targetUserId: 'target-user' });

    expect(result).toEqual({ outcome: 'case_not_found' });
  });

  it('is idempotent when there is no live grant and emits no separate audit query', async () => {
    queue([{ case_exists: true, grant_id: null, revoked_at: null, audit_written: false }]);

    const result = await revokeRestrictedCaseAccess({ actor: ACTOR, caseId: CASE_ID, targetUserId: 'target-user' });

    expect(result).toEqual({ outcome: 'already_revoked' });
    expect(sqlMock).toHaveBeenCalledTimes(2);
  });

  it('does not query users or require current ACTIVE target status during revoke', async () => {
    queue([{ case_exists: true, grant_id: null, revoked_at: null, audit_written: false }]);

    await revokeRestrictedCaseAccess({ actor: ACTOR, caseId: CASE_ID, targetUserId: 'inactive-target' });

    expect(calls[1].text).not.toContain('FROM users');
    expect(calls[1].text).not.toContain("status = 'ACTIVE'");
    expect(calls[1].values).toContain('inactive-target');
  });

  it('fails rather than reporting success if a returned revoke lacks its audit row', async () => {
    queue([{
      case_exists: true,
      grant_id: 'grant-1',
      revoked_at: '2026-09-25T07:00:00.000Z',
      audit_written: false,
    }]);

    await expect(revokeRestrictedCaseAccess({
      actor: ACTOR,
      caseId: CASE_ID,
      targetUserId: 'target-user',
    })).rejects.toThrow('revoke audit was not written');
  });
});

describe('grant-vs-revoke serialization', () => {
  function installSerializedAccessState(initialLive: boolean) {
    let liveGrant = initialLive;
    let tail = Promise.resolve();
    let grantSeq = 0;

    transactionMock.mockImplementation((build: (txn: typeof sqlMock) => QuerySpec[]) => {
      const queries = build(sqlMock);
      expect(queries).toHaveLength(2);
      const [lockQuery, mutationQuery] = queries;
      expect(lockQuery.text).toContain('pg_advisory_xact_lock');
      expect(lockQuery.text).toContain('hashtextextended');
      expect(lockQuery.values).toEqual([`${CASE_ID}:target-user`]);

      const run = tail.then(async () => {
        calls.push(lockQuery, mutationQuery);
        if (mutationQuery.text.includes('INSERT INTO hr_restricted_case_access')) {
          if (liveGrant) {
            return [[{ locked: null }], [{
              case_exists: true,
              target_eligible: true,
              grant_id: null,
              granted_at: null,
              audit_written: false,
            }]];
          }
          liveGrant = true;
          grantSeq += 1;
          return [[{ locked: null }], [{
            case_exists: true,
            target_eligible: true,
            grant_id: `grant-${grantSeq}`,
            granted_at: '2026-09-25T08:00:00.000Z',
            audit_written: true,
          }]];
        }

        if (mutationQuery.text.includes('UPDATE hr_restricted_case_access')) {
          if (!liveGrant) {
            return [[{ locked: null }], [{
              case_exists: true,
              grant_id: null,
              revoked_at: null,
              audit_written: false,
            }]];
          }
          liveGrant = false;
          return [[{ locked: null }], [{
            case_exists: true,
            grant_id: 'existing-grant',
            revoked_at: '2026-09-25T08:01:00.000Z',
            audit_written: true,
          }]];
        }

        throw new Error('unexpected mutation query');
      });
      tail = run.then(() => undefined, () => undefined);
      return run;
    });

    return { isLive: () => liveGrant };
  }

  it('revoke-first then concurrent grant observes the post-revoke snapshot and creates a fresh live grant', async () => {
    const state = installSerializedAccessState(true);

    const revokePromise = revokeRestrictedCaseAccess({ actor: ACTOR, caseId: CASE_ID, targetUserId: 'target-user' });
    const grantPromise = grantRestrictedCaseAccess({ actor: ACTOR, caseId: CASE_ID, targetUserId: 'target-user' });
    const [revokeResult, grantResult] = await Promise.all([revokePromise, grantPromise]);

    expect(revokeResult.outcome).toBe('revoked');
    expect(grantResult.outcome).toBe('granted');
    expect(state.isLive()).toBe(true);
  });

  it('grant-first then concurrent revoke observes the post-grant snapshot and revokes that live grant', async () => {
    const state = installSerializedAccessState(false);

    const grantPromise = grantRestrictedCaseAccess({ actor: ACTOR, caseId: CASE_ID, targetUserId: 'target-user' });
    const revokePromise = revokeRestrictedCaseAccess({ actor: ACTOR, caseId: CASE_ID, targetUserId: 'target-user' });
    const [grantResult, revokeResult] = await Promise.all([grantPromise, revokePromise]);

    expect(grantResult.outcome).toBe('granted');
    expect(revokeResult.outcome).toBe('revoked');
    expect(state.isLive()).toBe(false);
  });

  it('grant and revoke use the exact same deterministic case/user lock key before their mutation statement', async () => {
    queue(
      [{ case_exists: true, target_eligible: true, grant_id: null, granted_at: null, audit_written: false }],
      [{ locked: null }],
      [{ case_exists: true, grant_id: null, revoked_at: null, audit_written: false }],
    );

    await grantRestrictedCaseAccess({ actor: ACTOR, caseId: CASE_ID, targetUserId: 'target-user' });
    await revokeRestrictedCaseAccess({ actor: ACTOR, caseId: CASE_ID, targetUserId: 'target-user' });

    const grantLock = calls[0];
    const revokeLock = calls[2];
    expect(grantLock.text).toContain('pg_advisory_xact_lock');
    expect(revokeLock.text).toContain('pg_advisory_xact_lock');
    expect(grantLock.values).toEqual([`${CASE_ID}:target-user`]);
    expect(revokeLock.values).toEqual(grantLock.values);
  });
});

describe('isLiveRestrictedGrantUniqueViolation', () => {
  it('requires both PostgreSQL 23505 and the exact partial-index name', () => {
    expect(isLiveRestrictedGrantUniqueViolation(neonUnique('hr_restricted_case_access_one_live_grant'))).toBe(true);
    expect(isLiveRestrictedGrantUniqueViolation(neonUnique('different_unique_index'))).toBe(false);
    expect(isLiveRestrictedGrantUniqueViolation(new Error('duplicate'))).toBe(false);
  });
});
