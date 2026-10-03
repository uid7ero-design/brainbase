import { beforeEach, describe, expect, it, vi } from 'vitest';

const sqlMock = vi.fn();

vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => sqlMock(...args),
}));

const { getEmployeeDocumentAssuranceStatus } = await import(
  '@/lib/hr/employeeDocumentAssuranceStatus'
);

beforeEach(() => {
  vi.clearAllMocks();
  sqlMock.mockResolvedValue([{
    acknowledged_at: null,
    verification_decision: null,
    verification_at: null,
  }]);
});

describe('HR-7E6A employee document assurance status read model', () => {
  it('scopes acknowledgement and verification reads to the same organisation and version', async () => {
    await getEmployeeDocumentAssuranceStatus({
      organisationId: 'org-a',
      versionId: '11111111-1111-4111-8111-111111111111',
      linkedEmployeeUserId: 'user-a',
    });

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const [strings, ...values] = sqlMock.mock.calls[0];
    const query = (strings as TemplateStringsArray).join('?');

    expect(query).toContain('FROM hr_employee_document_acknowledgements a');
    expect(query).toContain('FROM hr_employee_document_verifications v');
    expect(query.match(/organisation_id = \?/g)).toHaveLength(2);
    expect(query.match(/document_version_id = \?::uuid/g)).toHaveLength(2);
    expect(values).toContain('org-a');
    expect(values).toContain('11111111-1111-4111-8111-111111111111');
  });

  it('only reads acknowledgement for the linked employee and selects no comment or verifier identity', async () => {
    await getEmployeeDocumentAssuranceStatus({
      organisationId: 'org-a',
      versionId: '11111111-1111-4111-8111-111111111111',
      linkedEmployeeUserId: 'linked-user',
    });

    const [strings, ...values] = sqlMock.mock.calls[0];
    const query = (strings as TemplateStringsArray).join('?');

    expect(query).toContain('a.acknowledged_by = ?');
    expect(values).toContain('linked-user');
    expect(query).not.toMatch(/\bcomment\b/i);
    expect(query).not.toMatch(/\bverified_by\b/i);
    expect(query).not.toMatch(/reminder/i);
    expect(query).not.toMatch(/storage_key/i);
  });

  it('returns acknowledgement state and only the latest verification decision/timestamp', async () => {
    sqlMock.mockResolvedValue([{
      acknowledged_at: '2026-10-03T01:02:03.000Z',
      verification_decision: 'VERIFIED',
      verification_at: '2026-10-03T02:03:04.000Z',
    }]);

    await expect(getEmployeeDocumentAssuranceStatus({
      organisationId: 'org-a',
      versionId: '11111111-1111-4111-8111-111111111111',
      linkedEmployeeUserId: 'user-a',
    })).resolves.toEqual({
      acknowledged: true,
      acknowledgedAt: '2026-10-03T01:02:03.000Z',
      latestVerification: {
        decision: 'VERIFIED',
        verifiedAt: '2026-10-03T02:03:04.000Z',
      },
    });
  });

  it('returns a safe empty state when there is no acknowledgement or verification', async () => {
    await expect(getEmployeeDocumentAssuranceStatus({
      organisationId: 'org-a',
      versionId: '11111111-1111-4111-8111-111111111111',
      linkedEmployeeUserId: null,
    })).resolves.toEqual({
      acknowledged: false,
      acknowledgedAt: null,
      latestVerification: null,
    });
  });

  it('fails closed on inconsistent verification state', async () => {
    sqlMock.mockResolvedValue([{
      acknowledged_at: null,
      verification_decision: 'REJECTED',
      verification_at: null,
    }]);

    await expect(getEmployeeDocumentAssuranceStatus({
      organisationId: 'org-a',
      versionId: '11111111-1111-4111-8111-111111111111',
      linkedEmployeeUserId: 'user-a',
    })).rejects.toThrow('incomplete state');
  });
});
