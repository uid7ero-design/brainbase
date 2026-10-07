import sql from '@/lib/db';
import { logFinanceCalendarCreated } from './auditLog';
import type { CommercialFinancialPeriod, CommercialFinancialYear } from './financialPeriods';

export class FinanceCalendarSetupError extends Error {
  constructor(public readonly code: 'INVALID_INPUT' | 'NOT_FOUND' | 'CLOSED_YEAR' | 'OUTSIDE_YEAR' | 'OVERLAP' | 'DUPLICATE_NAME', message: string) {
    super(message);
    this.name = 'FinanceCalendarSetupError';
  }
}

export function parseCalendarInput(body: unknown): { name: string; startsOn: string; endsOn: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new FinanceCalendarSetupError('INVALID_INPUT', 'A JSON object is required.');
  const input = body as Record<string, unknown>;
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 100) throw new FinanceCalendarSetupError('INVALID_INPUT', 'Name must contain 1 to 100 characters.');
  for (const key of ['startsOn', 'endsOn'] as const) {
    const value = input[key];
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) === '0000') {
      throw new FinanceCalendarSetupError('INVALID_INPUT', 'Enter valid calendar dates in YYYY-MM-DD format.');
    }
    const parsed = new Date(value + 'T00:00:00Z');
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new FinanceCalendarSetupError('INVALID_INPUT', 'Enter valid calendar dates in YYYY-MM-DD format.');
    }
  }
  const startsOn = input.startsOn as string, endsOn = input.endsOn as string;
  if (endsOn <= startsOn) throw new FinanceCalendarSetupError('INVALID_INPUT', 'End date must be after start date.');
  return { name, startsOn, endsOn };
}

// Separate lock statements ensure the guarded INSERT uses a fresh READ COMMITTED
// snapshot after waiting. Ranges are inclusive; adjacent periods share no day.
export async function createCalendarYear(organisationId: string, userId: string, body: unknown): Promise<CommercialFinancialYear> {
  const { name, startsOn, endsOn } = parseCalendarInput(body);
  const [, rows] = await sql.transaction(txn => [
    txn`SELECT pg_advisory_xact_lock(hashtextextended(${'finance-calendar|' + organisationId}, 0))`,
    txn`
      WITH checks AS MATERIALIZED (
        SELECT EXISTS(SELECT 1 FROM commercial_financial_years WHERE organisation_id=${organisationId} AND name=${name}) AS duplicate,
               EXISTS(SELECT 1 FROM commercial_financial_years WHERE organisation_id=${organisationId}
                 AND starts_on <= ${endsOn}::date AND ends_on >= ${startsOn}::date) AS overlap
      ), inserted AS (
        INSERT INTO commercial_financial_years(organisation_id,name,starts_on,ends_on)
        SELECT ${organisationId},${name},${startsOn}::date,${endsOn}::date FROM checks WHERE NOT duplicate AND NOT overlap
        RETURNING *
      )
      SELECT row_to_json(inserted)::jsonb || jsonb_build_object('starts_on', inserted.starts_on::text, 'ends_on', inserted.ends_on::text) AS record,
             NULL::text AS error FROM inserted
      UNION ALL
      SELECT NULL::jsonb,
             CASE WHEN duplicate THEN 'DUPLICATE_NAME' ELSE 'OVERLAP' END FROM checks
      WHERE NOT EXISTS(SELECT 1 FROM inserted)
    `,
  ], { isolationLevel: 'ReadCommitted' });
  const row = (rows as { record: CommercialFinancialYear; error: string | null }[])[0];
  if (row.error) throw new FinanceCalendarSetupError(row.error as 'DUPLICATE_NAME' | 'OVERLAP', row.error === 'DUPLICATE_NAME' ? 'A financial year with this name already exists.' : 'This financial year overlaps an existing year.');
  await logFinanceCalendarCreated({ organisationId, userId, kind: 'year', id: row.record.id,
    after: { name: row.record.name, starts_on: row.record.starts_on, ends_on: row.record.ends_on } });
  return row.record;
}

export async function createCalendarPeriod(organisationId: string, userId: string, financialYearId: string, body: unknown): Promise<CommercialFinancialPeriod> {
  const { name, startsOn, endsOn } = parseCalendarInput(body);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(financialYearId)) throw new FinanceCalendarSetupError('INVALID_INPUT', 'Invalid financial year.');
  const [, rows] = await sql.transaction(txn => [
    // Matches the parent-row lock used by year close/reopen.
    txn`SELECT id FROM commercial_financial_years WHERE organisation_id=${organisationId} AND id=${financialYearId}::uuid FOR UPDATE`,
    txn`
      WITH target AS MATERIALIZED (
        SELECT * FROM commercial_financial_years WHERE organisation_id=${organisationId} AND id=${financialYearId}::uuid
      ), checks AS MATERIALIZED (
        SELECT CASE
          WHEN NOT EXISTS(SELECT 1 FROM target) THEN 'NOT_FOUND'
          WHEN EXISTS(SELECT 1 FROM target WHERE status <> 'OPEN') THEN 'CLOSED_YEAR'
          WHEN EXISTS(SELECT 1 FROM target WHERE ${startsOn}::date < starts_on OR ${endsOn}::date > ends_on) THEN 'OUTSIDE_YEAR'
          WHEN EXISTS(SELECT 1 FROM commercial_financial_periods WHERE organisation_id=${organisationId} AND financial_year_id=${financialYearId}::uuid AND name=${name}) THEN 'DUPLICATE_NAME'
          WHEN EXISTS(SELECT 1 FROM commercial_financial_periods WHERE organisation_id=${organisationId} AND financial_year_id=${financialYearId}::uuid
            AND starts_on <= ${endsOn}::date AND ends_on >= ${startsOn}::date) THEN 'OVERLAP'
          ELSE NULL END AS error
      ), inserted AS (
        INSERT INTO commercial_financial_periods(organisation_id,financial_year_id,name,starts_on,ends_on)
        SELECT ${organisationId},${financialYearId}::uuid,${name},${startsOn}::date,${endsOn}::date FROM checks WHERE error IS NULL
        RETURNING *
      )
      SELECT row_to_json(inserted)::jsonb || jsonb_build_object('starts_on', inserted.starts_on::text, 'ends_on', inserted.ends_on::text) AS record,
             NULL::text AS error FROM inserted
      UNION ALL SELECT NULL::jsonb, error FROM checks WHERE error IS NOT NULL
    `,
  ], { isolationLevel: 'ReadCommitted' });
  const row = (rows as { record: CommercialFinancialPeriod; error: FinanceCalendarSetupError['code'] | null }[])[0];
  if (row.error) {
    const messages = { NOT_FOUND: 'Financial year not found.', CLOSED_YEAR: 'Reopen the financial year before adding periods.', OUTSIDE_YEAR: 'Period dates must stay within the financial year.', DUPLICATE_NAME: 'A period with this name already exists in this year.', OVERLAP: 'This period overlaps an existing period.', INVALID_INPUT: 'Invalid input.' };
    throw new FinanceCalendarSetupError(row.error, messages[row.error]);
  }
  await logFinanceCalendarCreated({ organisationId, userId, kind: 'period', id: row.record.id,
    after: { name: row.record.name, starts_on: row.record.starts_on, ends_on: row.record.ends_on, financial_year_id: financialYearId } });
  return row.record;
}
