import { beforeEach, describe, expect, it, vi } from 'vitest';

const isActiveUserInOrganisationMock = vi.fn();

vi.mock('@/lib/hr/validation', () => ({
  isActiveUserInOrganisation: (...args: unknown[]) =>
    isActiveUserInOrganisationMock(...args),
}));

const { validateRestrictedGrantTarget } = await import(
  '@/lib/hr/restrictedAccess'
);

beforeEach(() => {
  isActiveUserInOrganisationMock.mockReset();
});

describe('validateRestrictedGrantTarget', () => {
  it('rejects a user from another organisation', async () => {
    isActiveUserInOrganisationMock.mockResolvedValue(false);

    const result = await validateRestrictedGrantTarget(
      'org-a',
      'user-from-org-b',
    );

    expect(result).toEqual({
      eligible: false,
      reason: 'not_eligible',
    });
    expect(isActiveUserInOrganisationMock).toHaveBeenCalledOnce();
    expect(isActiveUserInOrganisationMock).toHaveBeenCalledWith(
      'user-from-org-b',
      'org-a',
    );
  });

  it('rejects an INACTIVE user in the active organisation', async () => {
    // isActiveUserInOrganisation() owns the ACTIVE-status predicate; false
    // therefore covers a same-org INACTIVE row without duplicating status
    // logic inside the restricted-access helper.
    isActiveUserInOrganisationMock.mockResolvedValue(false);

    const result = await validateRestrictedGrantTarget(
      'org-a',
      'inactive-user',
    );

    expect(result).toEqual({
      eligible: false,
      reason: 'not_eligible',
    });
    expect(isActiveUserInOrganisationMock).toHaveBeenCalledWith(
      'inactive-user',
      'org-a',
    );
  });

  it('rejects an INVITED user in the active organisation', async () => {
    isActiveUserInOrganisationMock.mockResolvedValue(false);

    const result = await validateRestrictedGrantTarget(
      'org-a',
      'invited-user',
    );

    expect(result).toEqual({
      eligible: false,
      reason: 'not_eligible',
    });
    expect(isActiveUserInOrganisationMock).toHaveBeenCalledWith(
      'invited-user',
      'org-a',
    );
  });

  it('accepts a valid ACTIVE user in the active organisation', async () => {
    isActiveUserInOrganisationMock.mockResolvedValue(true);

    const result = await validateRestrictedGrantTarget(
      'org-a',
      'active-user',
    );

    expect(result).toEqual({
      eligible: true,
      userId: 'active-user',
    });
    expect(isActiveUserInOrganisationMock).toHaveBeenCalledOnce();
    expect(isActiveUserInOrganisationMock).toHaveBeenCalledWith(
      'active-user',
      'org-a',
    );
  });
});
