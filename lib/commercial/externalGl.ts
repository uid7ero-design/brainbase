import 'server-only';
import sql from '@/lib/db';

export type ExternalGlMappingStatus = 'ACTIVE' | 'RETIRED';

export class ExternalGlError extends Error {
  constructor(
    public readonly code:
      | 'NOT_FOUND'
      | 'INVALID_INPUT'
      | 'OVERLAPPING_MAPPING'
      | 'EXTERNAL_IDENTITY_CONFLICT'
      | 'CURRENCY_MISMATCH',
    message: string,
  ) {
    super(message);
    this.name = 'ExternalGlError';
  }
}

export interface ExternalGlAccountMapping {
  id: string;
  organisation_id: string;
  source_system_id: string;
  external_gl_account_code: string;
  external_gl_account_name: string | null;
  budget_account_id: string;
  effective_from: string;
  effective_to: string | null;
  status: ExternalGlMappingStatus;
}
export interface ExternalGlEntry {
  id: string;
  organisation_id: string;
  source_system_id: string;
  external_entry_id: string;
  external_journal_id: string | null;
  external_account_code: string;
  external_cost_centre_code: string | null;
  transaction_date: string;
  accounting_period_key: string | null;
  description: string | null;
  currency: string;
  amount_minor_units: string | number | bigint;
  source_payload_hash: string;
  source_lineage_id: string;
  imported_by: string;
  imported_at: string;
}

function cleanRequired(value: string, field: string) {
  const clean = value.trim();
  if (!clean) throw new ExternalGlError('INVALID_INPUT', `${field} is required.`);
  return clean;
}

function dateOnly(value: string | Date) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

function cleanCurrency(value: string) {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ExternalGlError('INVALID_INPUT', 'Currency must be a three-letter ISO-style code.');
  }
  return currency;
}
export async function createExternalGlAccountMapping(params: {
  organisationId: string; userId: string; sourceSystemId: string;
  externalAccountCode: string; externalAccountName?: string | null;
  budgetAccountId: string; effectiveFrom: string; effectiveTo?: string | null;
}): Promise<ExternalGlAccountMapping> {
  const sourceSystemId = cleanRequired(params.sourceSystemId, 'sourceSystemId');
  const externalAccountCode = cleanRequired(params.externalAccountCode, 'externalAccountCode');
  const effectiveFrom = cleanRequired(params.effectiveFrom, 'effectiveFrom');
  const effectiveTo = params.effectiveTo?.trim() || null;

  const [, rows] = await sql.transaction(txn => [
    txn`
      WITH lock_guard AS MATERIALIZED (
        SELECT pg_advisory_xact_lock(
          hashtextextended(${params.organisationId + '|' + sourceSystemId + '|' + externalAccountCode}, 0)
        )
      )
      SELECT 1::int AS locked FROM lock_guard
    `,
    txn`
      WITH valid_account AS (
        SELECT id FROM commercial_budget_accounts
        WHERE id=${params.budgetAccountId}
          AND organisation_id=${params.organisationId} AND active=true
      ), conflict AS (
        SELECT 1 FROM commercial_external_gl_account_mappings existing
        WHERE existing.organisation_id=${params.organisationId}
          AND existing.source_system_id=${sourceSystemId}
          AND existing.external_gl_account_code=${externalAccountCode}
          AND existing.status='ACTIVE'          AND daterange(existing.effective_from,
              COALESCE(existing.effective_to + 1, 'infinity'::date), '[)')
            && daterange(${effectiveFrom}::date,
              COALESCE(${effectiveTo}::date + 1, 'infinity'::date), '[)')
      )
      INSERT INTO commercial_external_gl_account_mappings(
        organisation_id,source_system_id,external_gl_account_code,
        external_gl_account_name,budget_account_id,effective_from,effective_to,status,created_by
      )
      SELECT ${params.organisationId},${sourceSystemId},${externalAccountCode},
        ${params.externalAccountName?.trim() || null},${params.budgetAccountId},
        ${effectiveFrom}::date,${effectiveTo}::date,'ACTIVE',${params.userId}
      FROM valid_account WHERE NOT EXISTS (SELECT 1 FROM conflict)
      RETURNING *
    `,
  ], { isolationLevel: 'ReadCommitted' });

  const mapping = (rows as ExternalGlAccountMapping[])[0];
  if (mapping) return mapping;
  const account = await sql`SELECT id FROM commercial_budget_accounts
    WHERE id=${params.budgetAccountId} AND organisation_id=${params.organisationId} AND active=true`;
  if ((account as { id: string }[]).length === 0)
    throw new ExternalGlError('NOT_FOUND', 'Budget account not found for this organisation.');
  throw new ExternalGlError('OVERLAPPING_MAPPING',
    'An effective mapping already covers that external GL account and date range.');
}
export async function retireExternalGlAccountMapping(params: {
  organisationId: string; userId: string; mappingId: string; effectiveTo: string;
}): Promise<ExternalGlAccountMapping> {
  const rows = await sql`
    UPDATE commercial_external_gl_account_mappings
    SET status='RETIRED', effective_to=${params.effectiveTo}::date,
        retired_by=${params.userId}, retired_at=now()
    WHERE id=${params.mappingId} AND organisation_id=${params.organisationId}
      AND status='ACTIVE' AND ${params.effectiveTo}::date >= effective_from
    RETURNING *
  ` as ExternalGlAccountMapping[];
  if (!rows[0]) throw new ExternalGlError('NOT_FOUND', 'Active mapping not found.');
  return rows[0];
}

export async function importExternalGlEntry(params: {
  organisationId: string; userId: string; sourceSystemId: string;
  externalEntryId: string; externalJournalId?: string | null;
  externalAccountCode: string; externalCostCentreCode?: string | null;
  transactionDate: string; accountingPeriodKey?: string | null;
  description?: string | null; currency: string;
  amountMinorUnits: string | number | bigint; sourcePayloadHash: string;
  sourceLineageId: string;
}): Promise<{ outcome: 'IMPORTED' | 'IDEMPOTENT'; entry: ExternalGlEntry }> {  const sourceSystemId = cleanRequired(params.sourceSystemId, 'sourceSystemId');
  const externalEntryId = cleanRequired(params.externalEntryId, 'externalEntryId');
  const externalAccountCode = cleanRequired(params.externalAccountCode, 'externalAccountCode');
  const sourcePayloadHash = cleanRequired(params.sourcePayloadHash, 'sourcePayloadHash');
  const sourceLineageId = cleanRequired(params.sourceLineageId, 'sourceLineageId');
  const currency = cleanCurrency(params.currency);
  const inserted = await sql`
    INSERT INTO commercial_external_gl_entries(
      organisation_id,source_system_id,external_entry_id,external_journal_id,
      external_account_code,external_cost_centre_code,transaction_date,
      accounting_period_key,description,currency,amount_minor_units,
      source_payload_hash,source_lineage_id,imported_by
    ) VALUES (
      ${params.organisationId},${sourceSystemId},${externalEntryId},
      ${params.externalJournalId?.trim() || null},${externalAccountCode},
      ${params.externalCostCentreCode?.trim() || null},${params.transactionDate}::date,
      ${params.accountingPeriodKey?.trim() || null},${params.description?.trim() || null},
      ${currency},${params.amountMinorUnits.toString()}::bigint,
      ${sourcePayloadHash},${sourceLineageId},${params.userId}
    )
    ON CONFLICT (organisation_id,source_system_id,external_entry_id) DO NOTHING
    RETURNING *
  ` as ExternalGlEntry[];
  if (inserted[0]) return { outcome: 'IMPORTED', entry: inserted[0] };
  const existingRows = await sql`SELECT * FROM commercial_external_gl_entries
    WHERE organisation_id=${params.organisationId}
      AND source_system_id=${sourceSystemId} AND external_entry_id=${externalEntryId}` as ExternalGlEntry[];
  const existing = existingRows[0];
  if (!existing) throw new ExternalGlError('EXTERNAL_IDENTITY_CONFLICT', 'External identity conflict.');
  const same =
    existing.external_journal_id === (params.externalJournalId?.trim() || null)
    && existing.external_account_code === externalAccountCode
    && existing.external_cost_centre_code === (params.externalCostCentreCode?.trim() || null)
    && dateOnly(existing.transaction_date as unknown as string | Date) === params.transactionDate
    && existing.accounting_period_key === (params.accountingPeriodKey?.trim() || null)
    && existing.description === (params.description?.trim() || null)
    && existing.currency === currency
    && existing.amount_minor_units.toString() === params.amountMinorUnits.toString()
    && existing.source_payload_hash === sourcePayloadHash
    && existing.source_lineage_id === sourceLineageId;
  if (!same) throw new ExternalGlError('EXTERNAL_IDENTITY_CONFLICT',
    'The external identity already exists with different immutable source facts.');
  return { outcome: 'IDEMPOTENT', entry: existing };
}

export function assertSameReconciliationCurrency(brainBaseCurrency: string, externalGlCurrency: string) {
  if (cleanCurrency(brainBaseCurrency) !== cleanCurrency(externalGlCurrency)) {
    throw new ExternalGlError('CURRENCY_MISMATCH',
      'Cross-currency reconciliation is prohibited without an explicit FX policy.');
  }
}
