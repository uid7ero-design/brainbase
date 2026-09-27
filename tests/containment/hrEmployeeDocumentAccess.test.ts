import { describe, expect, it } from 'vitest';
import {
  canManageEmployeeDocument,
  canViewEmployeeDocument,
  type EmployeeDocumentActorContext,
  type EmployeeDocumentAccessTarget,
} from '@/lib/hr/employeeDocumentAccess';

function actor(overrides: Partial<EmployeeDocumentActorContext> = {}): EmployeeDocumentActorContext {
  return {
    organisationId: 'org-a',
    userId: 'employee-user',
    isHrAdministrator: false,
    ...overrides,
  };
}

function target(overrides: Partial<EmployeeDocumentAccessTarget> = {}): EmployeeDocumentAccessTarget {
  return {
    organisationId: 'org-a',
    personLinkedUserId: 'employee-user',
    ...overrides,
  };
}

describe('HR-7D employee document authorization', () => {
  it('allows linked employee self access', () => {
    expect(canViewEmployeeDocument(actor(), target())).toBe(true);
  });

  it('fails closed for an unlinked employee person record', () => {
    expect(canViewEmployeeDocument(actor(), target({ personLinkedUserId: null }))).toBe(false);
  });

  it('denies unrelated same-org users including managers', () => {
    expect(canViewEmployeeDocument(actor({ userId: 'manager-user' }), target())).toBe(false);
    expect(canViewEmployeeDocument(actor({ userId: 'unrelated-user' }), target())).toBe(false);
  });

  it('allows active HR administration inside the active organisation', () => {
    expect(canViewEmployeeDocument(actor({ userId: 'hr-user', isHrAdministrator: true }), target())).toBe(true);
    expect(canManageEmployeeDocument(
      actor({ userId: 'hr-user', isHrAdministrator: true }),
      target(),
    )).toBe(true);
  });

  it('denies cross-org access even for HR administration', () => {
    expect(canViewEmployeeDocument(
      actor({ isHrAdministrator: true }),
      target({ organisationId: 'org-b' }),
    )).toBe(false);
    expect(canManageEmployeeDocument(
      actor({ isHrAdministrator: true }),
      { organisationId: 'org-b' },
    )).toBe(false);
  });

  it('does not grant management authority to employee or manager actors', () => {
    expect(canManageEmployeeDocument(actor(), target())).toBe(false);
    expect(canManageEmployeeDocument(actor({ userId: 'manager-user' }), target())).toBe(false);
  });
});
