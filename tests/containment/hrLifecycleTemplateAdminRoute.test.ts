import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';

const requireSessionMock = vi.fn();
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>();
  return {
    ...actual,
    requireSession: (...args: unknown[]) => requireSessionMock(...args),
  };
});

const requireHrCapabilityMock = vi.fn();
vi.mock('@/lib/hr/capability', () => ({
  requireHrCapability: (...args: unknown[]) => requireHrCapabilityMock(...args),
}));

const resolveContextMock = vi.fn();
vi.mock('@/lib/hr/context', () => ({
  resolveHrAccessContext: (...args: unknown[]) => resolveContextMock(...args),
}));

const { requireLifecycleTemplateAdmin } = await import('@/lib/hr/lifecycleTemplateRoute');

const SESSION = {
  userId: 'user-1',
  organisationId: 'org-a',
  homeOrganisationId: 'org-a',
  role: 'viewer' as const,
  name: 'User',
};

beforeEach(() => {
  requireSessionMock.mockReset();
  requireHrCapabilityMock.mockReset();
  resolveContextMock.mockReset();
  requireSessionMock.mockResolvedValue(SESSION);
  requireHrCapabilityMock.mockResolvedValue({ key: 'people', config: {} });
  resolveContextMock.mockResolvedValue({
    organisationId: 'org-a',
    selfPersonId: null,
    isHrAdministrator: true,
    hasRestrictedHrAccess: false,
  });
});

describe('requireLifecycleTemplateAdmin', () => {
  it('returns 401 when session resolution fails', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'));
    const result = await requireLifecycleTemplateAdmin();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected denial');
    expect(result.response.status).toBe(401);
  });

  it('returns 503 when People capability cannot be verified', async () => {
    requireHrCapabilityMock.mockRejectedValue(new CapabilityDatabaseError());
    const result = await requireLifecycleTemplateAdmin();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected denial');
    expect(result.response.status).toBe(503);
  });

  it('returns hr_admin_required for a same-org non-HR user', async () => {
    resolveContextMock.mockResolvedValue({
      organisationId: 'org-a',
      selfPersonId: null,
      isHrAdministrator: false,
      hasRestrictedHrAccess: false,
    });

    const result = await requireLifecycleTemplateAdmin();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected denial');
    expect(result.response.status).toBe(403);
    expect(await result.response.json()).toEqual({
      error: 'HR administrator access is required.',
      code: 'hr_admin_required',
    });
  });

  it('returns the active-org session after HR-admin resolution succeeds', async () => {
    const result = await requireLifecycleTemplateAdmin();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected access');
    expect(result.context.session.organisationId).toBe('org-a');
    expect(resolveContextMock).toHaveBeenCalledWith({
      organisationId: 'org-a',
      userId: 'user-1',
      role: 'viewer',
    });
  });
});
