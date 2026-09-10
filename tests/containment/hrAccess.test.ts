import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  canViewPerson,
  canEditPerson,
  canViewConfidentialFields,
  canManageEmployment,
  canManageHrAccess,
  canAccessRestrictedHr,
  canFieldBeShown,
  type HrAccessContext,
  type HrPersonTarget,
} from '@/lib/hr/access';
import { classifyField, type HrFieldTierMap } from '@/lib/hr/fieldTiers';

// HR-0.5 §5 — regression coverage for the initial HR permission-helper
// shape. No hr_* tables or grants exist anywhere in this repo — every
// context/target object below is a fake fixture, as the HR-0.5 brief
// explicitly permits ("Tests may use mocked/fake access-context objects.
// Do not create HR database tables for these tests.").

function ctx(overrides: Partial<HrAccessContext> = {}): HrAccessContext {
  return {
    organisationId: 'org-1',
    selfPersonId: null,
    isHrAdministrator: false,
    hasRestrictedHrAccess: false,
    ...overrides,
  };
}

function target(overrides: Partial<HrPersonTarget> = {}): HrPersonTarget {
  return {
    organisationId: 'org-1',
    personId: 'person-1',
    managerPersonId: null,
    ...overrides,
  };
}

describe('self access', () => {
  it('a person can view their own record', () => {
    const self = ctx({ selfPersonId: 'person-1' });
    expect(canViewPerson(self, target({ personId: 'person-1' }))).toBe(true);
  });

  it('self access allows self-safe (internal-tier) fields', () => {
    const self = ctx({ selfPersonId: 'person-1' });
    expect(canFieldBeShown(self, target({ personId: 'person-1' }), 'internal')).toBe(true);
  });

  it('self access also allows confidential-tier fields on their own record', () => {
    const self = ctx({ selfPersonId: 'person-1' });
    expect(canFieldBeShown(self, target({ personId: 'person-1' }), 'confidential')).toBe(true);
  });

  it('self CANNOT access the restricted tier by default, even on their own record', () => {
    const self = ctx({ selfPersonId: 'person-1', hasRestrictedHrAccess: false });
    expect(canFieldBeShown(self, target({ personId: 'person-1' }), 'restricted')).toBe(false);
    expect(canAccessRestrictedHr(self, target({ personId: 'person-1' }))).toBe(false);
  });

  it('a person cannot edit or manage employment for someone else\'s record just by having a selfPersonId', () => {
    const self = ctx({ selfPersonId: 'person-1' });
    const other = target({ personId: 'person-2' });
    expect(canViewPerson(self, other)).toBe(false);
    expect(canEditPerson(self, other)).toBe(false);
    expect(canManageEmployment(self, other)).toBe(false);
  });
});

describe('direct manager relationship', () => {
  it('a direct manager can view their report\'s record', () => {
    const manager = ctx({ selfPersonId: 'manager-1' });
    const report = target({ personId: 'person-1', managerPersonId: 'manager-1' });
    expect(canViewPerson(manager, report)).toBe(true);
  });

  it('manager visibility does NOT extend to confidential fields by default', () => {
    const manager = ctx({ selfPersonId: 'manager-1' });
    const report = target({ personId: 'person-1', managerPersonId: 'manager-1' });
    expect(canViewConfidentialFields(manager, report)).toBe(false);
    expect(canFieldBeShown(manager, report, 'confidential')).toBe(false);
    expect(canFieldBeShown(manager, report, 'internal')).toBe(true);
  });

  it('a manager cannot edit or manage employment for a direct report (HR-admin only)', () => {
    const manager = ctx({ selfPersonId: 'manager-1' });
    const report = target({ personId: 'person-1', managerPersonId: 'manager-1' });
    expect(canEditPerson(manager, report)).toBe(false);
    expect(canManageEmployment(manager, report)).toBe(false);
  });

  it('manager access does not imply access to an unrelated employee (someone else\'s report)', () => {
    const manager = ctx({ selfPersonId: 'manager-1' });
    const unrelated = target({ personId: 'person-9', managerPersonId: 'someone-else' });
    expect(canViewPerson(manager, unrelated)).toBe(false);
  });

  it('a null managerPersonId on the target never matches a caller with a selfPersonId (no accidental null === null match)', () => {
    const someone = ctx({ selfPersonId: 'person-x' });
    const noManagerTarget = target({ personId: 'person-1', managerPersonId: null });
    expect(canViewPerson(someone, noManagerTarget)).toBe(false);
  });
});

describe('HR administrator behavior', () => {
  it('an explicit HR-admin grant allows viewing, editing, and managing employment for any in-org person', () => {
    const admin = ctx({ isHrAdministrator: true });
    const anyone = target({ personId: 'person-42' });
    expect(canViewPerson(admin, anyone)).toBe(true);
    expect(canEditPerson(admin, anyone)).toBe(true);
    expect(canViewConfidentialFields(admin, anyone)).toBe(true);
    expect(canManageEmployment(admin, anyone)).toBe(true);
    expect(canFieldBeShown(admin, anyone, 'confidential')).toBe(true);
  });

  it('an HR-admin grant allows managing HR access (granting/revoking other HR grants)', () => {
    const admin = ctx({ isHrAdministrator: true });
    expect(canManageHrAccess(admin)).toBe(true);
  });

  it('an HR-admin grant does NOT by itself unlock restricted-HR access', () => {
    const admin = ctx({ isHrAdministrator: true, hasRestrictedHrAccess: false });
    const anyone = target({ personId: 'person-42' });
    expect(canAccessRestrictedHr(admin, anyone)).toBe(false);
    expect(canFieldBeShown(admin, anyone, 'restricted')).toBe(false);
  });
});

describe('restricted-HR seam stays separate and narrower in both directions', () => {
  it('a restricted-HR grant WITHOUT HR-admin unlocks only restricted access, not general HR-admin behavior', () => {
    const restrictedOnly = ctx({ isHrAdministrator: false, hasRestrictedHrAccess: true });
    const anyone = target({ personId: 'person-42' });
    expect(canAccessRestrictedHr(restrictedOnly, anyone)).toBe(true);
    expect(canManageEmployment(restrictedOnly, anyone)).toBe(false);
    expect(canManageHrAccess(restrictedOnly)).toBe(false);
    expect(canViewPerson(restrictedOnly, anyone)).toBe(false); // not HR-admin, not self, not manager
  });
});

describe('org/global admin does not imply HR-admin access', () => {
  it('HrAccessContext has no field representing global role at all — the only way in is an explicit isHrAdministrator/hasRestrictedHrAccess grant', () => {
    // Constructing a context that represents "a super_admin with no HR
    // grant" is indistinguishable from any other non-HR-admin caller,
    // because the type itself carries no role concept to check.
    const superAdminButNoHrGrant = ctx({ isHrAdministrator: false, hasRestrictedHrAccess: false });
    const anyone = target({ personId: 'person-42' });
    expect(canViewPerson(superAdminButNoHrGrant, anyone)).toBe(false);
    expect(canEditPerson(superAdminButNoHrGrant, anyone)).toBe(false);
    expect(canManageEmployment(superAdminButNoHrGrant, anyone)).toBe(false);
    expect(canManageHrAccess(superAdminButNoHrGrant)).toBe(false);
    expect(canAccessRestrictedHr(superAdminButNoHrGrant, anyone)).toBe(false);
  });
});

describe('absence of a linked User/Person relationship fails safely', () => {
  it('a context with no selfPersonId and no HR grant can view/edit/manage nothing, without throwing', () => {
    const nobody = ctx({ selfPersonId: null, isHrAdministrator: false, hasRestrictedHrAccess: false });
    const anyone = target({ personId: 'person-1' });
    expect(() => {
      canViewPerson(nobody, anyone);
      canEditPerson(nobody, anyone);
      canManageEmployment(nobody, anyone);
      canAccessRestrictedHr(nobody, anyone);
    }).not.toThrow();
    expect(canViewPerson(nobody, anyone)).toBe(false);
  });
});

describe('cross-organisation context fails, even for an HR administrator', () => {
  it('an HR-admin in org-1 gets no access to a target in org-2', () => {
    const admin = ctx({ organisationId: 'org-1', isHrAdministrator: true });
    const otherOrgTarget = target({ organisationId: 'org-2', personId: 'person-1' });
    expect(canViewPerson(admin, otherOrgTarget)).toBe(false);
    expect(canEditPerson(admin, otherOrgTarget)).toBe(false);
    expect(canManageEmployment(admin, otherOrgTarget)).toBe(false);
    expect(canAccessRestrictedHr(admin, otherOrgTarget)).toBe(false);
  });

  it('self access also fails across organisations (a stale/mismatched context can never leak cross-tenant)', () => {
    const self = ctx({ organisationId: 'org-1', selfPersonId: 'person-1' });
    const otherOrgTarget = target({ organisationId: 'org-2', personId: 'person-1' });
    expect(canViewPerson(self, otherOrgTarget)).toBe(false);
  });
});

describe('classifyField — fails closed to the most protected tier', () => {
  const tiers: HrFieldTierMap = {
    internal: new Set(['full_name']),
    confidential: new Set(['personal_email']),
  };

  it('classifies a listed internal field correctly', () => {
    expect(classifyField(tiers, 'full_name')).toBe('internal');
  });

  it('classifies a listed confidential field correctly', () => {
    expect(classifyField(tiers, 'personal_email')).toBe('confidential');
  });

  it('an unlisted/unknown field defaults to restricted, not internal', () => {
    expect(classifyField(tiers, 'some_future_field')).toBe('restricted');
  });
});

describe('lib/hr/access.ts source — structurally decoupled from the global role hierarchy', () => {
  // These checks target actual imports/declarations, not prose — the file's
  // own explanatory comments legitimately name Role/ROLE_ORDER/super_admin
  // (to document WHY there is no dependency on them), so a bare word match
  // would false-positive on its own documentation.
  it('does not import the session or org module at all', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/hr/access.ts'), 'utf8');
    expect(src).not.toMatch(/import[\s\S]*?from ['"]@\/lib\/session['"]/);
    expect(src).not.toMatch(/import[\s\S]*?from ['"]@\/lib\/org['"]/);
  });

  it('HrAccessContext has no role-shaped field', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/hr/access.ts'), 'utf8');
    const typeStart = src.indexOf('export type HrAccessContext');
    const typeEnd = src.indexOf('};', typeStart);
    const typeBody = src.slice(typeStart, typeEnd).replace(/\/\*\*[\s\S]*?\*\//g, '');
    expect(typeBody).not.toMatch(/\brole\s*[?:]/i);
  });
});
