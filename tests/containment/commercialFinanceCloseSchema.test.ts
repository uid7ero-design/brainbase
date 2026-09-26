import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.resolve(process.cwd(), 'scripts/create-commercial-finance-close.sql'),
  'utf8',
);
const periods = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/commercial/financialPeriods.ts'),
  'utf8',
);
const domain = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/commercial/financeClose.ts'),
  'utf8',
);

describe('C7.9A — finance close schema/control contract', () => {
  it('adds the financial-period tenant-integrity anchor additively', () => {
    expect(migration).toContain('commercial_financial_periods_id_organisation_id_key');
    expect(migration).toContain('UNIQUE (id, organisation_id)');
    expect(migration).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i);
  });

  it('creates durable append-only close history with a tenant-safe period FK', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS commercial_financial_period_closes');
    expect(migration).toContain('FOREIGN KEY (financial_period_id, organisation_id)');
    expect(migration).toContain('REFERENCES commercial_financial_periods(id, organisation_id)');
    expect(migration).toContain("status IN ('CLOSED', 'INVALIDATED')");
  });

  it('permits only one current non-invalidated close per period', () => {
    expect(migration).toContain('idx_commercial_financial_period_closes_one_current');
    expect(migration).toMatch(/WHERE status = 'CLOSED'/);
    expect(migration).toContain('UNIQUE (financial_period_id, close_sequence)');
  });

  it('requires complete invalidation metadata for invalidated history', () => {
    expect(migration).toContain('commercial_financial_period_closes_invalidation_shape');
    expect(migration).toContain("status = 'INVALIDATED'");
    expect(migration).toContain('invalidated_by IS NOT NULL');
    expect(migration).toContain('length(btrim(invalidation_reason)) > 0');
  });

  it('captures close controls and serializes period transitions with row locks', () => {
    expect(domain).toContain("basis', 'C7_8_SOURCE_ACTUAL");
    expect(domain).toContain('sourceActualByCurrency');
    expect(domain).toContain('FOR UPDATE OF cfp, cfy');
    expect(domain).toContain("{ isolationLevel: 'ReadCommitted' }");
  });

  it('fails closed on overlap and closed parent financial year', () => {
    expect(domain).toContain("'FINANCIAL_YEAR_CLOSED'");
    expect(domain).toContain("'PERIOD_OVERLAP'");
    expect(domain).toContain('other.starts_on <= cfp.ends_on');
    expect(domain).toContain('other.ends_on >= cfp.starts_on');
  });

  it('requires governed reopen and preserves the prior close by invalidation', () => {
    expect(domain).toContain("'REOPEN_REASON_REQUIRED'");
    expect(domain).toContain("SET status = 'INVALIDATED'");
    expect(domain).toContain("SET status = 'OPEN'");
    expect(domain).not.toMatch(/DELETE FROM commercial_financial_period_closes/);
  });

  it('disables the legacy direct status-toggle bypass', () => {
    expect(periods).toContain('Direct financial-period status changes are disabled');
    expect(periods).not.toContain('UPDATE commercial_financial_periods SET status');
  });
});
