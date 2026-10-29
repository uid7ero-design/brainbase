import 'server-only';
import sql from '@/lib/db';
import { LEDGER_HISTORY_PAGE_SIZE, validateLedgerHistoryFilters, type LedgerHistoryFilters, type LedgerHistoryReport } from './ledgerEntryHistoryModel';

export async function listLedgerEntryHistory(organisationId: string, input: LedgerHistoryFilters, page: number): Promise<LedgerHistoryReport> {
  const scope = validateLedgerHistoryFilters(input);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new Error('Choose a valid history page.');
  const rows = await sql`
    WITH filtered AS MATERIALIZED (
      SELECT id,source_system_id,external_entry_id,external_journal_id,external_account_code,
        external_cost_centre_code,transaction_date,accounting_period_key,description,currency,
        amount_minor_units,source_payload_hash,source_lineage_id,imported_at
      FROM commercial_external_gl_entries
      WHERE organisation_id=${organisationId}
        AND (${scope.source}::text='' OR source_system_id=${scope.source})
        AND (${scope.account}::text='' OR external_account_code=${scope.account})
        AND (${scope.currency}::text='' OR currency=${scope.currency})
        AND (NULLIF(${scope.from}::text,'')::date IS NULL OR transaction_date>=NULLIF(${scope.from}::text,'')::date)
        AND (NULLIF(${scope.to}::text,'')::date IS NULL OR transaction_date<=NULLIF(${scope.to}::text,'')::date)
    ), page_rows AS (
      SELECT *,transaction_date::text AS date_text,amount_minor_units::text AS amount_text FROM filtered
      ORDER BY transaction_date DESC,imported_at DESC,id DESC
      LIMIT ${LEDGER_HISTORY_PAGE_SIZE} OFFSET ${(page-1)*LEDGER_HISTORY_PAGE_SIZE}
    ), totals AS (
      SELECT currency,COUNT(*)::int AS entry_count,SUM(amount_minor_units)::text AS amount_cents FROM filtered GROUP BY currency
    )
    SELECT (SELECT COUNT(*)::int FROM filtered) AS total_count,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'source_system_id',source_system_id,'external_entry_id',external_entry_id,
        'external_journal_id',external_journal_id,'external_account_code',external_account_code,'external_cost_centre_code',external_cost_centre_code,
        'transaction_date',date_text,'accounting_period_key',accounting_period_key,'description',description,'currency',currency,
        'amount_minor_units',amount_text,'source_payload_hash',source_payload_hash,'source_lineage_id',source_lineage_id,'imported_at',imported_at)
        ORDER BY transaction_date DESC,imported_at DESC,id DESC) FROM page_rows),'[]'::jsonb) AS entries,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('currency',currency,'entryCount',entry_count,'amountCents',amount_cents) ORDER BY currency) FROM totals),'[]'::jsonb) AS totals
  ` as Array<{ total_count: number; entries: LedgerHistoryReport['entries']; totals: LedgerHistoryReport['totals'] }>;
  const result = rows[0];
  if (!result) throw new Error('Unable to read ledger history.');
  return { scope, page, pageSize: LEDGER_HISTORY_PAGE_SIZE, totalCount: result.total_count, entries: result.entries, totals: result.totals };
}
