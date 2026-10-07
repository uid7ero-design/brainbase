import { describe, expect, it } from 'vitest';
import { projectPersonForAi, type AiSafeHrPersonProjection } from '@/lib/hr/aiSafePersonProjection';
import type { HrPersonRow } from '@/lib/hr/projectPerson';

const ROW: HrPersonRow = {
  id: 'person-secret-id',
  organisation_id: 'org-secret-id',
  linked_user_id: 'user-secret-id',
  first_name: 'Alex',
  last_name: 'SensitiveSurname',
  preferred_name: 'Lex',
  work_email: 'alex@example.com',
  work_phone: '+61 400 000 000',
  job_title: 'Operations Coordinator',
  worker_type: 'employee',
  employment_status: 'active',
  team_id: 'team-secret-id',
  manager_person_id: 'manager-secret-id',
  start_date: '2025-02-03',
  end_date: '2027-08-19',
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2026-10-06T00:00:00.000Z',
  team_name: 'Operations',
  manager_first_name: 'Morgan',
  manager_last_name: 'ManagerSurname',
};

const EXPECTED_KEYS = [
  'display_name',
  'job_title',
  'worker_type',
  'employment_status',
  'team_name',
  'manager_name',
] as const satisfies readonly (keyof AiSafeHrPersonProjection)[];

describe('HR-8A AI-safe person projection', () => {
  it('returns only the closed AI-safe allowlist', () => {
    const projection = projectPersonForAi(ROW);

    expect(Object.keys(projection).sort()).toEqual([...EXPECTED_KEYS].sort());
    expect(projection).toEqual({
      display_name: 'Lex',
      job_title: 'Operations Coordinator',
      worker_type: 'employee',
      employment_status: 'active',
      team_name: 'Operations',
      manager_name: 'Morgan',
    });
  });

  it('does not leak IDs, contact details, surnames, exact dates or timestamps', () => {
    const serialized = JSON.stringify(projectPersonForAi(ROW));

    for (const forbidden of [
      ROW.id,
      ROW.organisation_id,
      ROW.linked_user_id!,
      ROW.work_email!,
      ROW.work_phone!,
      ROW.last_name,
      ROW.team_id!,
      ROW.manager_person_id!,
      ROW.manager_last_name!,
      ROW.start_date!,
      ROW.end_date!,
      ROW.created_at,
      ROW.updated_at,
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('uses first name only when there is no preferred name', () => {
    const projection = projectPersonForAi({ ...ROW, preferred_name: null });
    expect(projection.display_name).toBe('Alex');
    expect(JSON.stringify(projection)).not.toContain('SensitiveSurname');
  });

  it('normalises missing derived joins to null without falling back to hidden IDs or surnames', () => {
    const projection = projectPersonForAi({
      ...ROW,
      team_name: undefined,
      manager_first_name: undefined,
      manager_last_name: 'StillHidden',
    });

    expect(projection.team_name).toBeNull();
    expect(projection.manager_name).toBeNull();
    expect(JSON.stringify(projection)).not.toContain('StillHidden');
    expect(JSON.stringify(projection)).not.toContain('manager-secret-id');
  });

  it('is structurally independent of newly-added HrPersonRow properties', () => {
    const widened = {
      ...ROW,
      hypothetical_future_sensitive_field: 'must-never-flow-through',
    } as HrPersonRow & { hypothetical_future_sensitive_field: string };

    expect(JSON.stringify(projectPersonForAi(widened))).not.toContain('must-never-flow-through');
  });
});
