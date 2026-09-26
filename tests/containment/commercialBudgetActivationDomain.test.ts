import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.resolve(process.cwd(), 'lib/commercial/budgetActivation.ts'), 'utf8');

describe('C7.7D — atomic Budget activation domain contract', () => {
  it('uses one READ COMMITTED transaction with a lock statement before validation/mutations', () => {
    expect(source).toContain("sql.transaction(txn => [");
    expect(source).toContain("isolationLevel: 'ReadCommitted'");
    const lock = source.indexOf('WITH budget_guard AS MATERIALIZED');
    const validation = source.indexOf('AS budget_exists');
    const supersede = source.indexOf("SET status = 'SUPERSEDED'");
    const activate = source.indexOf("SET status = 'ACTIVE'");
    const pointer = source.indexOf('SET active_version_id');
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(validation).toBeGreaterThan(lock);
    expect(supersede).toBeGreaterThan(validation);
    expect(activate).toBeGreaterThan(supersede);
    expect(pointer).toBeGreaterThan(activate);
  });

  it('locks the Budget, financial year, and all versions in deterministic order', () => {
    expect(source).toMatch(/FOR UPDATE OF cb, cfy/);
    expect(source).toMatch(/locked_versions AS MATERIALIZED[\s\S]*?ORDER BY bv\.id[\s\S]*?FOR UPDATE/);
  });

  it('requires the target version to remain DRAFT and financial year OPEN after locking', () => {
    expect(source).toMatch(/target\.status = 'DRAFT'/);
    expect(source).toMatch(/cfy\.status = 'OPEN'/);
  });

  it('validates active account\/cost-centre references for both lines and mappings', () => {
    expect(source).toMatch(/commercial_budget_lines[\s\S]*?ba\.active = false[\s\S]*?cc\.active = false/);
    expect(source).toMatch(/commercial_budget_commitment_mappings[\s\S]*?ba\.active = false[\s\S]*?cc\.active = false/);
  });

  it('enforces exact PERIODISED allocation equality and forbids allocations for ANNUAL_ONLY', () => {
    expect(source).toMatch(/periodisation_mode[\s\S]*?'ANNUAL_ONLY'[\s\S]*?NOT EXISTS/);
    expect(source).toMatch(/'PERIODISED'[\s\S]*?HAVING COALESCE\(SUM\(bpa\.amount_cents\), 0\) <> bl\.annual_budget_cents/);
  });

  it('rejects allocations belonging to another financial year', () => {
    expect(source).toMatch(/cfp\.financial_year_id <> cb\.financial_year_id/);
  });

  it('supersedes the previous ACTIVE version before activating the target and updating the pointer', () => {
    expect(source).toContain("SET status = 'SUPERSEDED', superseded_at = now()");
    expect(source).toContain("SET status = 'ACTIVE'");
    expect(source).toContain('SET active_version_id = \${params.budgetVersionId}');
  });

  it('emits activated and superseded audit events after the transaction succeeds', () => {
    expect(source).toContain('logBudgetVersionSuperseded');
    expect(source).toContain('logBudgetVersionActivated');
    expect(source.indexOf('await logBudgetVersionActivated')).toBeGreaterThan(source.indexOf('sql.transaction'));
  });
});
