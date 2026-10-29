import { buildCsv } from '@/lib/events/csvExport';
import { isFinanceCalendarDate } from './financeSetupDisplay';
import { validSavedLedgerEntry, type SavedLedgerEntry } from './externalGlImportDisplay';

export type LedgerHistoryFilters = { source: string; account: string; currency: string; from: string; to: string };
export const EMPTY_LEDGER_FILTERS: LedgerHistoryFilters = { source: '', account: '', currency: '', from: '', to: '' };
export const LEDGER_HISTORY_PAGE_SIZE = 25;
export type LedgerHistoryReport = {
  scope: LedgerHistoryFilters; page: number; pageSize: number; totalCount: number;
  entries: SavedLedgerEntry[]; totals: Array<{ currency: string; entryCount: number; amountCents: string }>;
};

export function validateLedgerHistoryFilters(input: LedgerHistoryFilters): LedgerHistoryFilters {
  const filters = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value.trim()])) as LedgerHistoryFilters;
  filters.currency = filters.currency.toUpperCase();
  if (filters.source.length > 300 || filters.account.length > 300) throw new Error('Source and account filters must be at most 300 characters.');
  if (filters.currency && !/^[A-Z]{3}$/.test(filters.currency)) throw new Error('Use a three-letter currency code.');
  if ((filters.from && !isFinanceCalendarDate(filters.from)) || (filters.to && !isFinanceCalendarDate(filters.to))) throw new Error('Choose valid transaction dates.');
  if (filters.from && filters.to && filters.from > filters.to) throw new Error('Start date must be on or before end date.');
  return filters;
}

export function parseLedgerHistoryReport(value: unknown, scope: LedgerHistoryFilters, page: number): LedgerHistoryReport {
  const fail = () => { throw new Error('Saved ledger history is incomplete or belongs to a different filter scope.'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const report = value as LedgerHistoryReport;
  if (!report.scope || Object.keys(EMPTY_LEDGER_FILTERS).some(key => report.scope[key as keyof LedgerHistoryFilters] !== scope[key as keyof LedgerHistoryFilters])
    || report.page !== page || report.pageSize !== LEDGER_HISTORY_PAGE_SIZE || !Number.isSafeInteger(report.totalCount) || report.totalCount < 0
    || !Array.isArray(report.entries) || report.entries.length > LEDGER_HISTORY_PAGE_SIZE || !report.entries.every(validSavedLedgerEntry)
    || new Set(report.entries.map(row => row.id)).size !== report.entries.length || !Array.isArray(report.totals)) return fail();
  const expectedCount = Math.min(LEDGER_HISTORY_PAGE_SIZE, Math.max(0, report.totalCount - (page - 1) * LEDGER_HISTORY_PAGE_SIZE));
  if (report.entries.length !== expectedCount || report.entries.some(row => (scope.source && row.source_system_id !== scope.source)
    || (scope.account && row.external_account_code !== scope.account) || (scope.currency && row.currency !== scope.currency)
    || (scope.from && row.transaction_date < scope.from) || (scope.to && row.transaction_date > scope.to))) return fail();
  if (report.totals.some(total => !total || typeof total.currency !== 'string' || !/^[A-Z]{3}$/.test(total.currency)
    || (scope.currency && total.currency !== scope.currency) || !Number.isSafeInteger(total.entryCount) || total.entryCount <= 0
    || typeof total.amountCents !== 'string' || !/^-?(0|[1-9]\d*)$/.test(total.amountCents))
    || new Set(report.totals.map(total => total.currency)).size !== report.totals.length
    || report.totals.reduce((sum, total) => sum + total.entryCount, 0) !== report.totalCount) return fail();
  for (const total of report.totals) if (report.entries.filter(row => row.currency === total.currency).length > total.entryCount) return fail();
  if (report.entries.some(row => !report.totals.some(total => total.currency === row.currency))) return fail();
  return report;
}

/** This export is deliberately limited to the currently confirmed page. */
export function buildLedgerHistoryPageCsv(report: LedgerHistoryReport): string {
  const safe = (value: string | null) => value && /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
  return buildCsv(['Page','Source','Entry identity','Transaction date','Account','Currency','Amount cents','Journal','Cost centre','External period','Description','Source evidence hash','Source lineage','Saved ID','Imported at'],
    report.entries.map(row => [report.page,safe(row.source_system_id),safe(row.external_entry_id),row.transaction_date,safe(row.external_account_code),row.currency,
      row.amount_minor_units,safe(row.external_journal_id),safe(row.external_cost_centre_code),safe(row.accounting_period_key),safe(row.description),safe(row.source_payload_hash),safe(row.source_lineage_id),safe(row.id),row.imported_at]));
}
