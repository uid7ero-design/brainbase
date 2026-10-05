import { beforeEach, describe, expect, it, vi } from 'vitest';

type QuerySpec = { text: string; values: unknown[] };
let responses: unknown[] = [];
let callCount = 0;
let calls: QuerySpec[] = [];

const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]): QuerySpec => ({
  text: strings.join('?'),
  values,
}));

const transactionMock = vi.fn(async (build: (txn: typeof sqlMock) => QuerySpec[]) => {
  const queries = build(sqlMock);
  const results: unknown[] = [];
  for (const query of queries) {
    calls.push(query);
    results.push(responses[callCount++] ?? []);
  }
  return results;
});

vi.mock('@/lib/db', () => ({
  default: Object.assign(
    (...args: [TemplateStringsArray, ...unknown[]]) => sqlMock(...args),
    {
      transaction: (...args: unknown[]) =>
        transactionMock(...(args as [(txn: typeof sqlMock) => QuerySpec[]])),
    },
  ),
}));

const {
  acknowledgeEmployeeDocumentVersion,
  verifyEmployeeDocumentVersion,
} = await import('@/lib/hr/employeeDocumentAssuranceMutations');

const PERSON_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';
const ACK_ID = '44444444-4444-4444-8444-444444444444';
const VERIFICATION_ID = '55555555-5555-4555-8555-555555555555';

const EMPLOYEE_ACTOR = {
  organisationId: 'org-a',
  userId: 'employee-user',
  isSuperAdmin: false,
  ipAddress: '203.0.113.10',
  userAgent: 'vitest',
};

const HR_ACTOR = {
  organisationId: 'org-a',
  userId: 'hr-user',
  isSuperAdmin: false,
  ipAddress: '203.0.113.20',
  userAgent: 'vitest',
};

function queue(...items: unknown[]) {
  responses = items;
  callCount = 0;
}

function acknowledgementRow(overrides: Record<string, unknown> = {}) {
  return {
    version_exists: true,
    authorized: true,
    acknowledgement_id: ACK_ID,
    acknowledged_by: 'employee-user',
    acknowledged_at: '2026-09-27T11:30:00.000Z',
    inserted: true,
    audit_written: true,
    ...overrides,
  };
}

function verificationRow(overrides: Record<string, unknown> = {}) {
  return {
    version_exists: true,
    authorized: true,
    verification_id: VERIFICATION_ID,
    verified_by: 'hr-user',
    decision: 'VERIFIED',
    comment: null,
    verified_at: '2026-09-27T11:31:00.000Z',
    audit_written: true,
    ...overrides,
  };
}

beforeEach(() => {
  responses = [];
  callCount = 0;
  calls = [];
  sqlMock.mockClear();
  transactionMock.mockClear();
});

describe('HR-7E3 employee document assurance mutations', () => {
  it('records linked-employee acknowledgement and its audit atomically', async () => {
    queue([{ locked: null }], [acknowledgementRow()]);

    const result = await acknowledgeEmployeeDocumentVersion({
      actor: EMPLOYEE_ACTOR,
      personId: PERSON_ID,
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
    });

    expect(result).toEqual({
      outcome: 'recorded',
      acknowledgement: {
        id: ACK_ID,
        documentVersionId: VERSION_ID,
        acknowledgedBy: 'employee-user',
        acknowledgedAt: '2026-09-27T11:30:00.000Z',
      },
    });
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(calls[0].text).toContain('pg_advisory_xact_lock');
    expect(calls[1].text).toContain('p.linked_user_id = ?');
    expect(calls[1].text).toContain('v.organisation_id = ?');
    expect(calls[1].text).toContain('d.person_id = ?::uuid');
    expect(calls[1].text).toContain('INSERT INTO hr_employee_document_acknowledgements');
    expect(calls[1].text).toContain("'hr_employee_document_acknowledgement.created'");
    expect(calls[1].text).toContain("'hr_employee_document_acknowledgement'");
    expect(calls[1].text).toContain('INSERT INTO audit_logs');
  });

  it('returns the existing acknowledgement idempotently without a second audit', async () => {
    queue([{ locked: null }], [acknowledgementRow({ inserted: false, audit_written: false })]);

    const result = await acknowledgeEmployeeDocumentVersion({
      actor: EMPLOYEE_ACTOR,
      personId: PERSON_ID,
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
    });

    expect(result.outcome).toBe('already_acknowledged');
    expect(calls[1].text).toContain('existing_acknowledgement AS MATERIALIZED');
    expect(calls[1].text).toContain('ON CONFLICT');
  });

  it('distinguishes missing version scope from denied acknowledgement authority', async () => {
    queue([{ locked: null }], [acknowledgementRow({
      version_exists: false,
      authorized: false,
      acknowledgement_id: null,
      acknowledged_by: null,
      acknowledged_at: null,
      inserted: false,
      audit_written: false,
    })]);
    await expect(acknowledgeEmployeeDocumentVersion({
      actor: EMPLOYEE_ACTOR,
      personId: PERSON_ID,
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
    })).resolves.toEqual({ outcome: 'version_not_found' });

    queue([{ locked: null }], [acknowledgementRow({
      authorized: false,
      acknowledgement_id: null,
      acknowledged_by: null,
      acknowledged_at: null,
      inserted: false,
      audit_written: false,
    })]);
    await expect(acknowledgeEmployeeDocumentVersion({
      actor: { ...EMPLOYEE_ACTOR, userId: 'manager-user' },
      personId: PERSON_ID,
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
    })).resolves.toEqual({ outcome: 'forbidden' });
  });

  it('fails acknowledgement if inserted business state is not accompanied by audit state', async () => {
    queue([{ locked: null }], [acknowledgementRow({ audit_written: false })]);

    await expect(acknowledgeEmployeeDocumentVersion({
      actor: EMPLOYEE_ACTOR,
      personId: PERSON_ID,
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
    })).rejects.toThrow(/acknowledgement audit was not written/);
  });

  it('appends an HR verification decision and its audit atomically', async () => {
    queue([{ locked: null }], [verificationRow({ decision: 'REJECTED', comment: 'Needs renewal' })]);

    const result = await verifyEmployeeDocumentVersion({
      actor: HR_ACTOR,
      personId: PERSON_ID,
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
      decision: 'REJECTED',
      comment: 'Needs renewal',
    });

    expect(result).toEqual({
      outcome: 'recorded',
      verification: {
        id: VERIFICATION_ID,
        documentVersionId: VERSION_ID,
        verifiedBy: 'hr-user',
        decision: 'REJECTED',
        comment: 'Needs renewal',
        verifiedAt: '2026-09-27T11:31:00.000Z',
      },
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].text).toContain('pg_advisory_xact_lock');
    expect(calls[1].text).toContain('FROM hr_administrators a');
    expect(calls[1].text).toContain('a.user_id = ?');
    expect(calls[1].text).toContain('INSERT INTO hr_employee_document_verifications');
    expect(calls[1].text).toContain("'hr_employee_document_verification.created'");
    expect(calls[1].text).toContain("'comment', '[redacted]'");
    expect(calls[1].text).not.toContain('ON CONFLICT');
  });

  it('permits super-admin verification within the active organisation', async () => {
    queue([{ locked: null }], [verificationRow({ verified_by: 'super-user' })]);

    const result = await verifyEmployeeDocumentVersion({
      actor: { ...HR_ACTOR, userId: 'super-user', isSuperAdmin: true },
      personId: PERSON_ID,
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
      decision: 'VERIFIED',
      comment: null,
    });

    expect(result.outcome).toBe('recorded');
    expect(calls[1].values).toContain(true);
    expect(calls[1].text).toContain('v.organisation_id = ?');
  });

  it('returns missing/forbidden verification outcomes without claiming success', async () => {
    queue([{ locked: null }], [verificationRow({
      version_exists: false,
      authorized: false,
      verification_id: null,
      verified_by: null,
      decision: null,
      verified_at: null,
      audit_written: false,
    })]);
    await expect(verifyEmployeeDocumentVersion({
      actor: HR_ACTOR,
      personId: PERSON_ID,
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
      decision: 'VERIFIED',
      comment: null,
    })).resolves.toEqual({ outcome: 'version_not_found' });

    queue([{ locked: null }], [verificationRow({
      authorized: false,
      verification_id: null,
      verified_by: null,
      decision: null,
      verified_at: null,
      audit_written: false,
    })]);
    await expect(verifyEmployeeDocumentVersion({
      actor: { ...HR_ACTOR, userId: 'manager-user' },
      personId: PERSON_ID,
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
      decision: 'VERIFIED',
      comment: null,
    })).resolves.toEqual({ outcome: 'forbidden' });
  });

  it('fails verification unless business state and audit state both persist', async () => {
    queue([{ locked: null }], [verificationRow({ audit_written: false })]);

    await expect(verifyEmployeeDocumentVersion({
      actor: HR_ACTOR,
      personId: PERSON_ID,
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
      decision: 'VERIFIED',
      comment: null,
    })).rejects.toThrow(/verification did not persist business and audit state/);
  });
});
