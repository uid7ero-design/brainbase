import { describe, expect, it } from 'vitest';
import { ALLOWED_TABLES, assertTablesAllowed } from '@/lib/hlna/dataEngine';

const LIFECYCLE_TABLES = [
  'hr_lifecycle_templates',
  'hr_lifecycle_template_tasks',
  'hr_lifecycle_workflows',
  'hr_lifecycle_tasks',
  'hr_lifecycle_task_approvals',
] as const;

describe('HR-7 lifecycle AI containment', () => {
  for (const table of LIFECYCLE_TABLES) {
    it(`${table} remains denied by the generic data engine`, () => {
      expect(() => assertTablesAllowed(`SELECT * FROM ${table}`))
        .toThrow(/not accessible through this query engine/i);
      expect(ALLOWED_TABLES.has(table)).toBe(false);
    });
  }

  it('joining an HR lifecycle table to an otherwise approved table is still denied', () => {
    expect(() => assertTablesAllowed(`
      SELECT *
      FROM waste_records w
      JOIN hr_lifecycle_tasks t
        ON t.organisation_id = w.organisation_id
    `)).toThrow(/not accessible through this query engine/i);
  });
});
