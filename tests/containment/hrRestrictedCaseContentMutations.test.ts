import { beforeEach, describe, expect, it, vi } from 'vitest';

type QuerySpec = { text: string; values: unknown[] };
let directResponse: unknown[] = [];
let txResponses: unknown[] = [];
let txCalls: QuerySpec[] = [];
let directCalls: QuerySpec[] = [];

const tag = vi.fn((strings: TemplateStringsArray, ...values: unknown[]): QuerySpec => ({ text: strings.join('?'), values }));
const directSql = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const q = { text: strings.join('?'), values };
  directCalls.push(q);
  return directResponse;
});
const transactionMock = vi.fn(async (build: (txn: typeof tag) => QuerySpec[]) => {
  const queries = build(tag);
  txCalls.push(...queries);
  return txResponses;
});

vi.mock('@/lib/db', () => ({
  default: Object.assign(
    (...args: [TemplateStringsArray, ...unknown[]]) => directSql(...args),
    { transaction: (...args: unknown[]) => transactionMock(...(args as [(txn: typeof tag) => QuerySpec[]])) },
  ),
}));

const {
  addRestrictedCaseParticipant,
  removeRestrictedCaseParticipant,
  createRestrictedCaseNote,
} = await import('@/lib/hr/restrictedCaseContentMutations');

const ACTOR = { organisationId: 'org-a', userId: 'admin-user', ipAddress: '203.0.113.4', userAgent: 'vitest' };
const CASE_ID = '11111111-1111-4111-8111-111111111111';
const PERSON_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  directResponse = [];
  txResponses = [];
  txCalls = [];
  directCalls = [];
  tag.mockClear();
  directSql.mockClear();
  transactionMock.mockClear();
});

describe('restricted participant mutations', () => {
  it('serializes add by deterministic case/person lock and writes participant + audit in the second statement', async () => {
    txResponses = [
      [{ locked: null }],
      [{ case_exists: true, person_exists: true, participant_id: 'p1', role_in_case: 'witness', created: true, audit_written: true }],
    ];
    const result = await addRestrictedCaseParticipant({ actor: ACTOR, caseId: CASE_ID, personId: PERSON_ID, roleInCase: 'witness' });
    expect(result).toEqual({ outcome: 'created', participantId: 'p1', roleInCase: 'witness' });
    expect(txCalls).toHaveLength(2);
    expect(txCalls[0].text).toContain('pg_advisory_xact_lock');
    expect(txCalls[0].values).toEqual([`hr-restricted-participant:${CASE_ID}:${PERSON_ID}`]);
    expect(txCalls[1].text).toContain('INSERT INTO hr_restricted_case_participants');
    expect(txCalls[1].text).toContain('INSERT INTO audit_logs');
    expect(txCalls[1].text).toContain("'hr_restricted_case_participant.added'");
    expect(txCalls[1].text).toContain('organisation_id = ?');
  });

  it('returns an idempotent existing participant without requiring an audit row', async () => {
    txResponses = [
      [{ locked: null }],
      [{ case_exists: true, person_exists: true, participant_id: 'p1', role_in_case: 'subject', created: false, audit_written: false }],
    ];
    await expect(addRestrictedCaseParticipant({ actor: ACTOR, caseId: CASE_ID, personId: PERSON_ID, roleInCase: 'subject' }))
      .resolves.toEqual({ outcome: 'already_participant', participantId: 'p1', roleInCase: 'subject' });
  });

  it('collapses missing/wrong-org case and person independently', async () => {
    txResponses = [[{ locked: null }], [{ case_exists: false, person_exists: true, participant_id: null, role_in_case: null, created: false, audit_written: false }]];
    await expect(addRestrictedCaseParticipant({ actor: ACTOR, caseId: CASE_ID, personId: PERSON_ID, roleInCase: 'subject' }))
      .resolves.toEqual({ outcome: 'case_not_found' });

    txResponses = [[{ locked: null }], [{ case_exists: true, person_exists: false, participant_id: null, role_in_case: null, created: false, audit_written: false }]];
    await expect(addRestrictedCaseParticipant({ actor: ACTOR, caseId: CASE_ID, personId: PERSON_ID, roleInCase: 'subject' }))
      .resolves.toEqual({ outcome: 'person_not_found' });
  });

  it('fails closed if a created participant lacks its atomic audit row', async () => {
    txResponses = [[{ locked: null }], [{ case_exists: true, person_exists: true, participant_id: 'p1', role_in_case: 'subject', created: true, audit_written: false }]];
    await expect(addRestrictedCaseParticipant({ actor: ACTOR, caseId: CASE_ID, personId: PERSON_ID, roleInCase: 'subject' }))
      .rejects.toThrow('participant add audit was not written');
  });

  it('serializes removal on the identical case/person key, deletes only the scoped participant, and audits only actual removal', async () => {
    txResponses = [[{ locked: null }], [{ case_exists: true, removed_id: 'p1', audit_written: true }]];
    await expect(removeRestrictedCaseParticipant({ actor: ACTOR, caseId: CASE_ID, personId: PERSON_ID }))
      .resolves.toEqual({ outcome: 'removed' });
    expect(txCalls[0].values).toEqual([`hr-restricted-participant:${CASE_ID}:${PERSON_ID}`]);
    expect(txCalls[1].text).toContain('DELETE FROM hr_restricted_case_participants');
    expect(txCalls[1].text).toContain("'hr_restricted_case_participant.removed'");

    txCalls = [];
    txResponses = [[{ locked: null }], [{ case_exists: true, removed_id: null, audit_written: false }]];
    await expect(removeRestrictedCaseParticipant({ actor: ACTOR, caseId: CASE_ID, personId: PERSON_ID }))
      .resolves.toEqual({ outcome: 'already_removed' });
  });
});

describe('restricted note mutation', () => {
  it('inserts append-only note and audit in one writable CTE without putting the body into audit JSON', async () => {
    directResponse = [{ note_id: 'n1', created_at: '2026-09-25T04:00:00Z', audit_written: true }];
    const result = await createRestrictedCaseNote({ actor: ACTOR, caseId: CASE_ID, body: 'highly sensitive narrative' });
    expect(result).toEqual({ noteId: 'n1', createdAt: '2026-09-25T04:00:00Z' });
    expect(directCalls).toHaveLength(1);
    const q = directCalls[0];
    expect(q.text).toContain('INSERT INTO hr_restricted_case_notes');
    expect(q.text).toContain('INSERT INTO audit_logs');
    expect(q.text).toContain("'hr_restricted_case_note.created'");
    const auditJsonFragment = q.text.split('jsonb_build_object(')[1]?.split(')')[0] ?? '';
    expect(auditJsonFragment).toContain("'case_id'");
    expect(auditJsonFragment).toContain("'author_id'");
    expect(auditJsonFragment).not.toContain("'body'");
    expect(q.values).toContain('highly sensitive narrative');
  });

  it('does not expose update/delete semantics for note history', async () => {
    directResponse = [{ note_id: 'n1', created_at: 'x', audit_written: true }];
    await createRestrictedCaseNote({ actor: ACTOR, caseId: CASE_ID, body: 'note' });
    expect(directCalls[0].text).not.toMatch(/UPDATE\s+hr_restricted_case_notes/i);
    expect(directCalls[0].text).not.toMatch(/DELETE\s+FROM\s+hr_restricted_case_notes/i);
  });

  it('fails closed if the note mutation does not observe its audit row', async () => {
    directResponse = [{ note_id: 'n1', created_at: 'x', audit_written: false }];
    await expect(createRestrictedCaseNote({ actor: ACTOR, caseId: CASE_ID, body: 'note' }))
      .rejects.toThrow('note create audit was not written');
  });
});
