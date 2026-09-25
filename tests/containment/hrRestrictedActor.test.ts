import { describe, expect, it } from 'vitest';
import type { OrgSession } from '@/lib/org';
import { restrictedActorFromSession } from '@/lib/hr/restrictedAccess';

const ORDINARY_SESSION: OrgSession = {
  userId: 'user-a',
  organisationId: 'org-a',
  homeOrganisationId: 'org-a',
  role: 'manager',
  name: 'User A',
};

const SUPER_ADMIN_OVERRIDE_SESSION: OrgSession = {
  userId: 'founder-user',
  organisationId: 'org-school',
  homeOrganisationId: 'founder-org',
  role: 'super_admin',
  name: 'Founder',
};

describe('restrictedActorFromSession', () => {
  it('attributes the actor to the authenticated session user for ordinary HR actions', () => {
    const actor = restrictedActorFromSession(ORDINARY_SESSION);

    expect(actor).toEqual({
      userId: 'user-a',
      organisationId: 'org-a',
      homeOrganisationId: 'org-a',
      isOrgOverride: false,
    });
  });

  it('preserves super_admin actor attribution while operating under an organisation override', () => {
    const actor = restrictedActorFromSession(SUPER_ADMIN_OVERRIDE_SESSION);

    expect(actor).toEqual({
      userId: 'founder-user',
      organisationId: 'org-school',
      homeOrganisationId: 'founder-org',
      isOrgOverride: true,
    });
  });

  it('does not treat an ordinary mismatched session shape as a super_admin organisation override', () => {
    const actor = restrictedActorFromSession({
      ...ORDINARY_SESSION,
      organisationId: 'org-b',
      homeOrganisationId: 'org-a',
    });

    expect(actor.isOrgOverride).toBe(false);
    expect(actor.userId).toBe('user-a');
    expect(actor.organisationId).toBe('org-b');
    expect(actor.homeOrganisationId).toBe('org-a');
  });

  it('rejects actor spoofing structurally: client-shaped actor fields cannot override session.userId', () => {
    const spoofedInput = {
      ...ORDINARY_SESSION,
      granted_by: 'attacker-user',
      revoked_by: 'attacker-user',
      opened_by: 'attacker-user',
      author_id: 'attacker-user',
      uploaded_by: 'attacker-user',
      actorUserId: 'attacker-user',
    } as OrgSession & Record<string, unknown>;

    const actor = restrictedActorFromSession(spoofedInput);

    expect(actor.userId).toBe('user-a');
    expect(actor.userId).not.toBe('attacker-user');
    expect(actor).toEqual({
      userId: 'user-a',
      organisationId: 'org-a',
      homeOrganisationId: 'org-a',
      isOrgOverride: false,
    });
  });
});
