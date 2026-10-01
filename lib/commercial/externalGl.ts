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

export async function listExternalGlSourceSystemIds(
  organisationId: string,
): Promise<string[]> {
  const rows = await sql`
    SELECT source_system_id
    FROM (
      SELECT source_system_id
      FROM commercial_external_gl_account_mappings
      WHERE organisation_id=${organisationId}
      UNION
      SELECT source_system_id
      FROM commercial_external_gl_entries
      WHERE organisation_id=${organisationId}
      UNION
      SELECT source_system_id
      FROM commercial_finance_reconciliations
      WHERE organisation_id=${organisationId}
    ) finance_sources
    WHERE length(btrim(source_system_id)) > 0
    ORDER BY lower(source_system_id), source_system_id
  ` as { source_system_id: string }[];

  return rows.map(row => row.source_system_id);
}

function cleanRequired(value: string, field: string) {
  const clean = value.trim();
  if (!clean) throw new ExternalGlError('INVALID_INPUT', `${field} is required.`);
  return clean;
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
}): Promise<{
  outcome: 'IMPORTED' | 'IDEMPOTENT';
  entry: ExternalGlEntry;
  staleReconciliationCount: number;
}> {
  const sourceSystemId = cleanRequired(params.sourceSystemId, 'sourceSystemId');
  const externalEntryId = cleanRequired(params.externalEntryId, 'externalEntryId');
  const externalAccountCode = cleanRequired(params.externalAccountCode, 'externalAccountCode');
  const sourcePayloadHash = cleanRequired(params.sourcePayloadHash, 'sourcePayloadHash');
  const sourceLineageId = cleanRequired(params.sourceLineageId, 'sourceLineageId');
  const currency = cleanCurrency(params.currency);
  const externalJournalId = params.externalJournalId?.trim() || null;
  const externalCostCentreCode = params.externalCostCentreCode?.trim() || null;
  const accountingPeriodKey = params.accountingPeriodKey?.trim() || null;
  const description = params.description?.trim() || null;
  const amountMinorUnits = params.amountMinorUnits.toString();

  type ImportDecisionRow = ExternalGlEntry & {
    import_outcome: 'IMPORTED' | 'IDEMPOTENT' | 'CONFLICT';
    stale_reconciliation_count: number;
  };

  const rows = await sql`
    WITH inserted AS (
      INSERT INTO commercial_external_gl_entries(
        organisation_id,source_system_id,external_entry_id,external_journal_id,
        external_account_code,external_cost_centre_code,transaction_date,
        accounting_period_key,description,currency,amount_minor_units,
        source_payload_hash,source_lineage_id,imported_by
      ) VALUES (
        ${params.organisationId},${sourceSystemId},${externalEntryId},
        ${externalJournalId},${externalAccountCode},${externalCostCentreCode},
        ${params.transactionDate}::date,${accountingPeriodKey},${description},
        ${currency},${amountMinorUnits}::bigint,${sourcePayloadHash},
        ${sourceLineageId},${params.userId}
      )
      ON CONFLICT (organisation_id,source_system_id,external_entry_id) DO NOTHING
      RETURNING *
    ),
    existing AS (
      SELECT entry.*
      FROM commercial_external_gl_entries entry
      WHERE entry.organisation_id=${params.organisationId}
        AND entry.source_system_id=${sourceSystemId}
        AND entry.external_entry_id=${externalEntryId}
        AND NOT EXISTS (SELECT 1 FROM inserted)
    ),
    comparison AS (
      SELECT existing.*,
        (
          existing.external_journal_id IS NOT DISTINCT FROM ${externalJournalId}
          AND existing.external_account_code=${externalAccountCode}
          AND existing.external_cost_centre_code IS NOT DISTINCT FROM ${externalCostCentreCode}
          AND existing.transaction_date=${params.transactionDate}::date
          AND existing.accounting_period_key IS NOT DISTINCT FROM ${accountingPeriodKey}
          AND existing.description IS NOT DISTINCT FROM ${description}
          AND existing.currency=${currency}
          AND existing.amount_minor_units=${amountMinorUnits}::bigint
          AND existing.source_payload_hash=${sourcePayloadHash}
          AND existing.source_lineage_id=${sourceLineageId}
        ) AS same
      FROM existing
    ),
    decision AS (
      SELECT 'IMPORTED'::text AS import_outcome, inserted.*
      FROM inserted
      UNION ALL
      SELECT CASE WHEN comparison.same THEN 'IDEMPOTENT' ELSE 'CONFLICT' END,
             comparison.id,comparison.organisation_id,comparison.source_system_id,
             comparison.external_entry_id,comparison.external_journal_id,
             comparison.external_account_code,comparison.external_cost_centre_code,
             comparison.transaction_date,comparison.accounting_period_key,
             comparison.description,comparison.currency,comparison.amount_minor_units,
             comparison.source_payload_hash,comparison.source_lineage_id,
             comparison.imported_by,comparison.imported_at
      FROM comparison
    ),
    affected_observations AS (
      SELECT inserted.transaction_date,inserted.currency
      FROM inserted
      UNION
      SELECT comparison.transaction_date,comparison.currency
      FROM comparison
      WHERE NOT comparison.same
      UNION
      SELECT ${params.transactionDate}::date,${currency}
      WHERE EXISTS (SELECT 1 FROM comparison WHERE NOT comparison.same)
    ),
    staled AS (
      UPDATE commercial_finance_reconciliations reconciliation
      SET status='STALE'
      FROM commercial_financial_periods period,
           commercial_financial_period_closes close_record
      WHERE reconciliation.organisation_id=${params.organisationId}
        AND reconciliation.source_system_id=${sourceSystemId}
        AND reconciliation.status='SIGNED_OFF'
        AND period.id=reconciliation.financial_period_id
        AND period.organisation_id=reconciliation.organisation_id
        AND close_record.id=reconciliation.close_id
        AND close_record.organisation_id=reconciliation.organisation_id
        AND close_record.status='CLOSED'
        AND EXISTS (
          SELECT 1
          FROM affected_observations affected
          WHERE affected.currency=reconciliation.currency
            AND affected.transaction_date BETWEEN period.starts_on AND period.ends_on
        )
      RETURNING reconciliation.id,reconciliation.organisation_id,reconciliation.close_id
    ),
    close_updated AS (
      UPDATE commercial_financial_period_closes close_record
      SET reconciliation_status='STALE'
      WHERE close_record.organisation_id=${params.organisationId}
        AND close_record.id IN (SELECT close_id FROM staled)
      RETURNING close_record.id
    ),
    events AS (
      INSERT INTO commercial_finance_reconciliation_events(
        organisation_id,reconciliation_id,event_type,actor_user_id,details
      )
      SELECT staled.organisation_id,staled.id,'STALE',${params.userId},
        jsonb_build_object(
          'cause',
          CASE
            WHEN EXISTS (SELECT 1 FROM inserted) THEN 'EXTERNAL_GL_NEW_ENTRY'
            ELSE 'EXTERNAL_GL_CHANGED_IDENTITY'
          END,
          'externalEntryId',${externalEntryId},
          'sourceSystemId',${sourceSystemId},
          'incomingTransactionDate',${params.transactionDate},
          'incomingCurrency',${currency},
          'sourceLineageId',${sourceLineageId}
        )
      FROM staled
      RETURNING reconciliation_id
    )
    SELECT decision.*,
           (SELECT COUNT(*)::int FROM staled) AS stale_reconciliation_count
    FROM decision
  ` as ImportDecisionRow[];

  const row = rows[0];
  if (!row) {
    throw new ExternalGlError('EXTERNAL_IDENTITY_CONFLICT', 'External identity conflict.');
  }

  const { import_outcome, stale_reconciliation_count, ...entry } = row;
  if (import_outcome === 'CONFLICT') {
    throw new ExternalGlError(
      'EXTERNAL_IDENTITY_CONFLICT',
      'The external identity already exists with different immutable source facts.',
    );
  }

  return {
    outcome: import_outcome,
    entry,
    staleReconciliationCount: stale_reconciliation_count,
  };
}

export function assertSameReconciliationCurrency(brainBaseCurrency: string, externalGlCurrency: string) {
  if (cleanCurrency(brainBaseCurrency) !== cleanCurrency(externalGlCurrency)) {
    throw new ExternalGlError('CURRENCY_MISMATCH',
      'Cross-currency reconciliation is prohibited without an explicit FX policy.');
  }
}
