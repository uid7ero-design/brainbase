import { beforeEach, describe, expect, it, vi } from 'vitest';

const sqlMock = vi.fn();

vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => sqlMock(...args),
}));

const {
  EMPLOYEE_DOCUMENT_REMINDER_STALE_CLAIM_MINUTES,
  countStaleEmployeeDocumentReminderClaims,
} = await import('@/lib/hr/employeeDocumentReminderRecoveryVisibility');

beforeEach(() => {
  vi.clearAllMocks();
  sqlMock.mockResolvedValue([{ stale_claimed: 0 }]);
});

describe('HR-7E5I stale employee document reminder claim visibility', () => {
  it('uses a conservative 30-minute stale threshold', () => {
    expect(EMPLOYEE_DOCUMENT_REMINDER_STALE_CLAIM_MINUTES).toBe(30);
  });

  it('counts only CLAIMED rows older than the threshold and performs no mutation', async () => {
    sqlMock.mockResolvedValue([{ stale_claimed: 4 }]);

    await expect(countStaleEmployeeDocumentReminderClaims()).resolves.toBe(4);

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const [strings, minutes] = sqlMock.mock.calls[0];
    const query = (strings as TemplateStringsArray).join('?');

    expect(query).toContain("delivery_status = 'CLAIMED'");
    expect(query).toContain('claimed_at IS NOT NULL');
    expect(query).toContain('claimed_at < NOW() - make_interval');
    expect(query).toContain('COUNT(*)::int AS stale_claimed');
    expect(minutes).toBe(30);

    expect(query).not.toMatch(/\bUPDATE\b/i);
    expect(query).not.toMatch(/\bINSERT\b/i);
    expect(query).not.toMatch(/\bDELETE\b/i);
  });

  it('rejects malformed database state rather than inventing a count', async () => {
    sqlMock.mockResolvedValue([]);

    await expect(countStaleEmployeeDocumentReminderClaims())
      .rejects.toThrow('stale-claim count returned invalid state');
  });
});
