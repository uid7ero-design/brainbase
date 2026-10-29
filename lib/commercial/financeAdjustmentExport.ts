import { buildCsv, type CsvCell } from '@/lib/events/csvExport';
import { formatAustralianTimestamp, isFinanceAuditTimestamp } from './financeSetupDisplay';
import { buildAdjustmentEvidenceHtml } from './financeAdjustmentReport';
import {
  adjustmentLineTotals, parseAdjustmentEvidence, parseAdjustmentRegister,
  type AdjustmentEvidence, type AdjustmentHeader, type AdjustmentRegister, type AdjustmentScope,
} from './financeAdjustmentReviewModel';

export type AdjustmentExportKind = 'register' | 'register-record' | 'summary' | 'lines' | 'lifecycle' | 'record' | 'report';
export type AdjustmentExportInput = {
  scope: AdjustmentScope;
  report: AdjustmentRegister;
  evidence: AdjustmentEvidence | null;
  registerReadAt: string;
  evidenceReadAt: string | null;
  exportedAt: string;
};
const headerColumns = ['Adjustment ID', 'Adjustment number', 'Saved status', 'Type', 'Period ID', 'Period', 'Currency', 'Description', 'Reason', 'Reference period ID', 'Source type', 'Source ID', 'Reversal of ID', 'Created by', 'Created at ISO', 'Created at (Australian format, viewer timezone)', 'Posted by', 'Posted at ISO', 'Reversed by', 'Reversed at ISO'];
const safe = (value: string | null): string | null => value && (/^[\s\u0000-\u001f]*[=+\-@]/.test(value) || /^\d+(?:\.\d+)?$/.test(value)) ? `'${value}` : value;
const protect = (cells: CsvCell[]) => cells.map(cell => typeof cell === 'string' ? safe(cell) : cell);
function headerValues(header: AdjustmentHeader): CsvCell[] {
  return [header.id, exactText(header.number), header.status, header.type, header.periodId, header.periodName, header.currency,
    header.description, header.reason, header.referencePeriodId, header.sourceType, header.sourceId, header.reversalOf,
    header.createdBy, header.createdAt, formatAustralianTimestamp(header.createdAt), header.postedBy, header.postedAt, header.reversedBy, header.reversedAt];
}
// Exact identifiers and money are text cells, including positive values, so a
// spreadsheet cannot silently reduce them to its own numeric precision.
const exactText = (value: string) => `'${value}`;
/** Exact signed decimal currency units. Totals may exceed an individual BIGINT line. */
function decimal(cents: string): string {
  const value = BigInt(cents), absolute = value < BigInt(0) ? -value : value;
  return `${value < BigInt(0) ? '-' : ''}${absolute / BigInt(100)}.${(absolute % BigInt(100)).toString().padStart(2, '0')}`;
}

/** Exports only validated loaded reads; never fetches, mutates or reclassifies finance records. */
export function buildAdjustmentExport(input: AdjustmentExportInput, kind: AdjustmentExportKind) {
  if (!['register', 'register-record', 'summary', 'lines', 'lifecycle', 'record', 'report'].includes(kind)) throw new Error('Unknown adjustment export.');
  if (!isFinanceAuditTimestamp(input.exportedAt) || !isFinanceAuditTimestamp(input.registerReadAt)) throw new Error('Export or register read timestamp is unavailable.');
  if (!Number.isSafeInteger(input.report.page) || input.report.page < 1) throw new Error('Register page is unavailable.');
  const report = parseAdjustmentRegister(input.report, input.scope, input.report.page);
  const registerOnly = kind === 'register' || kind === 'register-record';
  const scopeColumns = ['Exported at ISO', 'Register read completed at ISO', 'Detail read completed at ISO', 'Selected period ID', 'Selected currency', 'Selected status', 'Selected adjustment type', 'Applied search'];
  const scopeValues = [input.exportedAt, input.registerReadAt, registerOnly ? null : input.evidenceReadAt, input.scope.periodId, input.scope.currency, input.scope.status || 'ALL', input.scope.adjustmentType||'ALL', input.scope.search??''];
  const csv = (columns: string[], rows: CsvCell[][]) => buildCsv([...scopeColumns, ...columns], rows.map(row => protect([...scopeValues, ...row])));
  const filenameScope = `${input.scope.currency}-period-${input.scope.periodId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)}`;
  if (kind === 'register-record') {
    return { filename: `finance-adjustments-${filenameScope}-page-${report.page}.json`, type: 'application/json;charset=utf-8', content: JSON.stringify({
      format: 'brainbase-finance-adjustment-register-page', version: 1, exportedAt: input.exportedAt,
      registerReadCompletedAt: input.registerReadAt,
      purpose: 'Displayed loaded page only. Matching count covers all pages; records on other pages are excluded. Read-completion time is a browser observation, not a database snapshot timestamp. Not a restore file or sign-off.',
      report,
    }, null, 2) };
  }
  if (kind === 'register') {
    return { filename: `finance-adjustments-${filenameScope}-page-${report.page}.csv`, type: 'text/csv;charset=utf-8',
      content: csv(['Displayed page', 'Matching count across pages', ...headerColumns], report.adjustments.map(row => [report.page, report.totalCount, ...headerValues(row)])) };
  }
  if (!input.evidence) throw new Error('Select and load saved adjustment evidence before exporting.');
  if (!isFinanceAuditTimestamp(input.evidenceReadAt)) throw new Error('Detail read timestamp is unavailable.');
  const evidence = parseAdjustmentEvidence(input.evidence, input.scope, input.evidence.adjustment.id);
  if (!report.adjustments.some(row => row.id === evidence.adjustment.id)) throw new Error('The selected adjustment is not on this register page.');
  const header = evidence.adjustment;
  const filename = `finance-adjustment-${header.number}-${filenameScope}-${kind}`;
  if (kind === 'report') {
    return { filename: `${filename}.html`, type: 'text/html;charset=utf-8', content: buildAdjustmentEvidenceHtml({
      evidence, scope: input.scope, registerPage: report.page,
      registerStatus: report.adjustments.find(row => row.id === header.id)!.status,
      registerReadAt: input.registerReadAt, evidenceReadAt: input.evidenceReadAt, exportedAt: input.exportedAt,
    }) };
  }
  if (kind === 'record') {
    return { filename: `${filename}.json`, type: 'application/json;charset=utf-8', content: JSON.stringify({
      format: 'brainbase-finance-adjustment-evidence', version: 1, exportedAt: input.exportedAt,
      registerReadCompletedAt: input.registerReadAt, detailReadCompletedAt: input.evidenceReadAt,
      scope: input.scope, registerPage: report.page,
      purpose: 'Loaded saved evidence only. Read-completion times are browser observations, not database snapshot timestamps. Not a restore file, sign-off, or recalculation of Budget Actual.',
      evidence,
    }, null, 2) };
  }
  const common = headerValues(header);
  if (kind === 'summary') {
    const totals = adjustmentLineTotals(evidence.lines);
    return { filename: `${filename}.csv`, type: 'text/csv;charset=utf-8', content: csv([...headerColumns, 'Saved lines', 'Lifecycle events', 'Exclusive total cents', 'Exclusive total', 'Tax total cents', 'Tax total', 'Inclusive total cents', 'Inclusive total'],
      [[...common, evidence.lines.length, evidence.events.length, exactText(totals[0]), exactText(decimal(totals[0])), exactText(totals[1]), exactText(decimal(totals[1])), exactText(totals[2]), exactText(decimal(totals[2]))]]) };
  }
  if (kind === 'lines') {
    return { filename: `${filename}.csv`, type: 'text/csv;charset=utf-8', content: csv([...headerColumns,
      'Line ID', 'Position', 'Account ID', 'Account code', 'Account name', 'Cost centre ID', 'Cost centre code', 'Cost centre name',
      'Exclusive cents', 'Exclusive amount', 'Tax cents', 'Tax amount', 'Inclusive cents', 'Inclusive amount',
      'Classification', 'Resolved Budget ID', 'Resolved version ID', 'Resolved line ID', 'Resolved tax basis', 'Budget cents', 'Budget amount', 'Source bill line ID', 'Narrative'],
    evidence.lines.map(line => [...common, line.id, line.position, line.accountId, line.accountCode, line.accountName, line.centreId, line.centreCode, line.centreName,
      exactText(line.exclusiveCents), exactText(decimal(line.exclusiveCents)), exactText(line.taxCents), exactText(decimal(line.taxCents)), exactText(line.inclusiveCents), exactText(decimal(line.inclusiveCents)),
      line.resolvedBasis === null ? 'UNRESOLVED' : 'RESOLVED', line.resolvedBudgetId, line.resolvedVersionId, line.resolvedLineId, line.resolvedBasis,
      line.budgetCents === null ? null : exactText(line.budgetCents), line.budgetCents === null ? null : exactText(decimal(line.budgetCents)), line.sourceBillLineId, line.narrative])) };
  }
  return { filename: `${filename}.csv`, type: 'text/csv;charset=utf-8', content: csv([...headerColumns,
    'Event ID', 'Event', 'Actor ID', 'When ISO', 'When (Australian format, viewer timezone)', 'Event reason', 'Reversal of ID (event)', 'Reversal adjustment ID (event)', 'Generated by reversal of ID (event)', 'Complete event details JSON'],
  evidence.events.map(event => [...common, event.id, event.type, event.actor, event.at, formatAustralianTimestamp(event.at),
    typeof event.details.reason === 'string' ? event.details.reason : null,
    typeof event.details.reversalOf === 'string' ? event.details.reversalOf : null,
    typeof event.details.reversalAdjustmentId === 'string' ? event.details.reversalAdjustmentId : null,
    typeof event.details.generatedByReversalOf === 'string' ? event.details.generatedByReversalOf : null, JSON.stringify(event.details)])) };
}
