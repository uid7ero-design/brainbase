import { describe, it, expect, vi, beforeEach } from 'vitest';

// HR-2 — direct unit coverage for lib/hr/capability.ts's checkHrCapability
// and requireHrCapability, the HR-specific People-module bypass for
// super_admin. This proves the bypass in isolation, independent of any
// route wiring (app/api/hr/**'s and app/people/layout.tsx's own coverage
// prove they call these functions; this file proves what the functions
// themselves do). The underlying lib/capabilities/requireCapability is
// mocked so a super_admin call can be proven to never reach it at all.

const checkCapabilityMock = vi.fn();
const requireCapabilityMock = vi.fn();
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>();
  return {
    ...actual,
    checkCapability: (...args: unknown[]) => checkCapabilityMock(...args),
    requireCapability: (...args: unknown[]) => requireCapabilityMock(...args),
  };
});

const { checkHrCapability, requireHrCapability } = await import('@/lib/hr/capability');

beforeEach(() => {
  checkCapabilityMock.mockReset();
  requireCapabilityMock.mockReset();
});

describe('checkHrCapability', () => {
  it('resolves allowed: true for super_admin without ever calling the real checkCapability', async () => {
    const result = await checkHrCapability('org-a', 'super_admin');
    expect(result.allowed).toBe(true);
    expect(checkCapabilityMock).not.toHaveBeenCalled();
  });

  it('resolves allowed: true for super_admin even in an organisation where the real check would fail', async () => {
    checkCapabilityMock.mockResolvedValue({ allowed: false });
    const result = await checkHrCapability('org-a', 'super_admin');
    expect(result.allowed).toBe(true);
    expect(checkCapabilityMock).not.toHaveBeenCalled();
  });

  it('delegates to the real checkCapability, scoped to "people", for every non-super_admin role', async () => {
    checkCapabilityMock.mockResolvedValue({ allowed: true, entitlement: { key: 'people', config: {} } });
    const result = await checkHrCapability('org-a', 'manager');
    expect(result.allowed).toBe(true);
    expect(checkCapabilityMock).toHaveBeenCalledWith('org-a', 'people');
  });

  it('returns the real denial for a non-super_admin whose organisation has not enabled People', async () => {
    checkCapabilityMock.mockResolvedValue({ allowed: false });
    const result = await checkHrCapability('org-a', 'manager');
    expect(result.allowed).toBe(false);
  });
});

describe('requireHrCapability', () => {
  it('returns null for super_admin without ever calling the real requireCapability', async () => {
    const result = await requireHrCapability('org-a', 'super_admin');
    expect(result).toBeNull();
    expect(requireCapabilityMock).not.toHaveBeenCalled();
  });

  it('does not throw for super_admin even when the real requireCapability would reject', async () => {
    requireCapabilityMock.mockRejectedValue(new Error('should never be called'));
    await expect(requireHrCapability('org-a', 'super_admin')).resolves.toBeNull();
  });

  it('delegates to the real requireCapability, scoped to "people", for every non-super_admin role', async () => {
    requireCapabilityMock.mockResolvedValue({ key: 'people', config: {} });
    const result = await requireHrCapability('org-a', 'manager');
    expect(result).toEqual({ key: 'people', config: {} });
    expect(requireCapabilityMock).toHaveBeenCalledWith('org-a', 'people');
  });

  it('propagates the real rejection (e.g. CapabilityAccessError) for a non-super_admin, unchanged from HR-1', async () => {
    const { CapabilityAccessError } = await import('@/lib/capabilities/requireCapability');
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('NO_ENTITLEMENT'));
    await expect(requireHrCapability('org-a', 'manager')).rejects.toBeInstanceOf(CapabilityAccessError);
  });
});
