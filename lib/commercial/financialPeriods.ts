import sql from '@/lib/db';
import { logFinancialYearStatusChanged, logFinancialPeriodStatusChanged } from './auditLog';

// Phase C2 — tenant-scoped data access for commercial_financial_years /
// commercial_financial_periods. Deliberately independent of Debtors'
// own imported debtor_accounts.financial_year TEXT field — see
// scripts/create-commercial-core.sql's header comment.

export type FinancialStatus = 'OPEN' | 'CLOSED';

export interface CommercialFinancialYear {
  id: string;
  organisation_id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  status: FinancialStatus;
  created_at: string;
  updated_at: string;
}

export interface CommercialFinancialPeriod {
  id: string;
  financial_year_id: string;
  organisation_id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  status: FinancialStatus;
  created_at: string;
  updated_at: string;
}

export async function listFinancialYears(organisationId: string): Promise<CommercialFinancialYear[]> {
  return (await sql`
    SELECT * FROM commercial_financial_years WHERE organisation_id = ${organisationId} ORDER BY starts_on DESC
  `) as CommercialFinancialYear[];
}

export async function getFinancialYear(organisationId: string, financialYearId: string): Promise<CommercialFinancialYear | null> {
  const rows = (await sql`
    SELECT * FROM commercial_financial_years WHERE id = ${financialYearId} AND organisation_id = ${organisationId}
  `) as CommercialFinancialYear[];
  return rows[0] ?? null;
}

// The CHECK (ends_on > starts_on) constraint (scripts/create-commercial-
// core.sql) is the actual enforcement of a valid date range — this
// function does not duplicate that check in application code; an
// invalid range surfaces as a thrown Postgres CHECK-violation error.
export async function createFinancialYear(params: {
  organisationId: string; name: string; startsOn: string; endsOn: string;
}): Promise<CommercialFinancialYear> {
  const rows = (await sql`
    INSERT INTO commercial_financial_years (organisation_id, name, starts_on, ends_on)
    VALUES (${params.organisationId}, ${params.name}, ${params.startsOn}, ${params.endsOn})
    RETURNING *
  `) as CommercialFinancialYear[];
  return rows[0];
}

// Composite-FK'd onto commercial_financial_years(id, organisation_id) —
// a period for one organisation's financial year structurally cannot be
// created against a different organisation's year, even if this
// function were ever called with a mismatched pair by a future caller
// bug (the INSERT itself would fail the FK constraint).
export async function createFinancialPeriod(params: {
  organisationId: string; financialYearId: string; name: string; startsOn: string; endsOn: string;
}): Promise<CommercialFinancialPeriod> {
  const rows = (await sql`
    INSERT INTO commercial_financial_periods (organisation_id, financial_year_id, name, starts_on, ends_on)
    VALUES (${params.organisationId}, ${params.financialYearId}, ${params.name}, ${params.startsOn}, ${params.endsOn})
    RETURNING *
  `) as CommercialFinancialPeriod[];
  return rows[0];
}

export async function listFinancialPeriods(organisationId: string, financialYearId: string): Promise<CommercialFinancialPeriod[]> {
  return (await sql`
    SELECT * FROM commercial_financial_periods
    WHERE organisation_id = ${organisationId} AND financial_year_id = ${financialYearId}
    ORDER BY starts_on ASC
  `) as CommercialFinancialPeriod[];
}

export async function setFinancialYearStatus(params: {
  organisationId: string; userId: string; financialYearId: string; status: FinancialStatus;
}): Promise<CommercialFinancialYear | null> {
  const before = await getFinancialYear(params.organisationId, params.financialYearId);
  if (!before) return null;
  if (before.status === params.status) return before;

  const rows = (await sql`
    UPDATE commercial_financial_years SET status = ${params.status}, updated_at = now()
    WHERE id = ${params.financialYearId} AND organisation_id = ${params.organisationId}
    RETURNING *
  `) as CommercialFinancialYear[];
  const after = rows[0];

  await logFinancialYearStatusChanged({
    organisationId: params.organisationId, userId: params.userId, financialYearId: params.financialYearId,
    before: before.status, after: after.status,
  });

  return after;
}

export async function getFinancialPeriod(organisationId: string, financialPeriodId: string): Promise<CommercialFinancialPeriod | null> {
  const rows = (await sql`
    SELECT * FROM commercial_financial_periods WHERE id = ${financialPeriodId} AND organisation_id = ${organisationId}
  `) as CommercialFinancialPeriod[];
  return rows[0] ?? null;
}

export async function setFinancialPeriodStatus(params: {
  organisationId: string; userId: string; financialPeriodId: string; status: FinancialStatus;
}): Promise<CommercialFinancialPeriod | null> {
  const before = await getFinancialPeriod(params.organisationId, params.financialPeriodId);
  if (!before) return null;
  if (before.status === params.status) return before;

  const rows = (await sql`
    UPDATE commercial_financial_periods SET status = ${params.status}, updated_at = now()
    WHERE id = ${params.financialPeriodId} AND organisation_id = ${params.organisationId}
    RETURNING *
  `) as CommercialFinancialPeriod[];
  const after = rows[0];

  await logFinancialPeriodStatusChanged({
    organisationId: params.organisationId, userId: params.userId, financialPeriodId: params.financialPeriodId,
    before: before.status, after: after.status,
  });

  return after;
}
