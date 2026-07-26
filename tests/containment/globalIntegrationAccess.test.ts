import { describe, it, expect, vi, beforeEach } from 'vitest';

const getAuthSessionMock = vi.fn();
vi.mock('@/lib/authSession', () => ({
  getAuthSession: () => getAuthSessionMock(),
}));

const { requireGlobalIntegrationAccess, IntegrationAccessError, integrationAccessErrorStatus } =
  await import('@/lib/globalIntegrationAccess');

const ENV_VAR = 'TEST_OWNER_ORG_ID';

describe('lib/globalIntegrationAccess', () => {
  beforeEach(() => {
    getAuthSessionMock.mockReset();
    delete process.env[ENV_VAR];
  });

  it('denies anonymous callers (no session) with 401', async () => {
    getAuthSessionMock.mockRejectedValue(new Error('Unauthorized'));
    await expect(requireGlobalIntegrationAccess(ENV_VAR)).rejects.toBeInstanceOf(IntegrationAccessError);
    try {
      await requireGlobalIntegrationAccess(ENV_VAR);
    } catch (err) {
      expect(integrationAccessErrorStatus(err)).toBe(401);
    }
  });

  it('always allows super_admin regardless of owner-org configuration', async () => {
    getAuthSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'other-org', role: 'super_admin', name: 'A', email: 'a@x.com' });
    const session = await requireGlobalIntegrationAccess(ENV_VAR, 'manager');
    expect(session.role).toBe('super_admin');
  });

  it('fails closed (403) when the owner-org env var is not configured, even for a manager', async () => {
    getAuthSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'A', email: 'a@x.com' });
    await expect(requireGlobalIntegrationAccess(ENV_VAR, 'manager')).rejects.toBeInstanceOf(IntegrationAccessError);
    try {
      await requireGlobalIntegrationAccess(ENV_VAR, 'manager');
    } catch (err) {
      expect(integrationAccessErrorStatus(err)).toBe(403);
    }
  });

  it('denies a manager from an organisation other than the configured owner org', async () => {
    process.env[ENV_VAR] = 'owner-org';
    getAuthSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'unrelated-org', role: 'manager', name: 'A', email: 'a@x.com' });
    await expect(requireGlobalIntegrationAccess(ENV_VAR, 'manager')).rejects.toBeInstanceOf(IntegrationAccessError);
  });

  it('allows a sufficiently-privileged member of the configured owner org', async () => {
    process.env[ENV_VAR] = 'owner-org';
    getAuthSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'owner-org', role: 'manager', name: 'A', email: 'a@x.com' });
    const session = await requireGlobalIntegrationAccess(ENV_VAR, 'manager');
    expect(session.organisationId).toBe('owner-org');
  });

  it('denies an owner-org member whose role is below the required minimum', async () => {
    process.env[ENV_VAR] = 'owner-org';
    getAuthSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'owner-org', role: 'viewer', name: 'A', email: 'a@x.com' });
    await expect(requireGlobalIntegrationAccess(ENV_VAR, 'manager')).rejects.toBeInstanceOf(IntegrationAccessError);
  });
});
