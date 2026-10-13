import { australianDateToIso, isFinanceCalendarDate, isFinanceAuditTimestamp } from './financeSetupDisplay';

export type LedgerImportInput = {
  sourceSystemId: string; externalEntryId: string; externalAccountCode: string;
  transactionDate: string; currency: string; amountMinorUnits: string;
  sourcePayloadHash: string; sourceLineageId: string; externalJournalId: string | null;
  externalCostCentreCode: string | null; accountingPeriodKey: string | null; description: string | null;
};
export type LedgerImportDraft = Record<keyof LedgerImportInput, string>;
export type SavedLedgerEntry = {
  id: string; source_system_id: string; external_entry_id: string; external_account_code: string;
  transaction_date: string; currency: string; amount_minor_units: string;
  source_payload_hash: string; source_lineage_id: string; external_journal_id: string | null;
  external_cost_centre_code: string | null; accounting_period_key: string | null;
  description: string | null; imported_at: string;
};
export const emptyLedgerDraft: LedgerImportDraft = {
  sourceSystemId: '', externalEntryId: '', externalAccountCode: '', transactionDate: '', currency: 'AUD', amountMinorUnits: '',
  sourcePayloadHash: '', sourceLineageId: '', externalJournalId: '', externalCostCentreCode: '', accountingPeriodKey: '', description: '',
};

export function signedLedgerAmountToCents(value: string): string {
  const input = value.trim();
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(input)) throw new Error('Enter a signed amount such as 100.00 or -100.00, with at most two decimal places.');
  const negative = input.startsWith('-');
  const [whole, fraction = ''] = input.replace('-', '').replaceAll(',', '').split('.');
  const magnitude = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
  const cents = negative ? -magnitude : magnitude;
  if (cents < BigInt('-9223372036854775808') || cents > BigInt('9223372036854775807')) throw new Error('Amount is outside the supported range.');
  return cents.toString();
}

export function prepareLedgerImport(draft: LedgerImportDraft): LedgerImportInput {
  const required = (key: keyof LedgerImportDraft) => {
    const value = draft[key].trim();
    if (!value || value.length > 300) throw new Error('Enter source, entry identity, account code, source hash and lineage, each up to 300 characters.');
    return value;
  };
  const sourcePayloadHash = required('sourcePayloadHash');
  if (sourcePayloadHash.length < 32) throw new Error('Use the original source evidence hash of at least 32 characters.');
  const currency = draft.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Enter a three-letter currency code.');
  return {
    sourceSystemId: required('sourceSystemId'), externalEntryId: required('externalEntryId'), externalAccountCode: required('externalAccountCode'),
    sourcePayloadHash, sourceLineageId: required('sourceLineageId'), currency,
    transactionDate: australianDateToIso(draft.transactionDate), amountMinorUnits: signedLedgerAmountToCents(draft.amountMinorUnits),
    externalJournalId: draft.externalJournalId.trim() || null, externalCostCentreCode: draft.externalCostCentreCode.trim() || null,
    accountingPeriodKey: draft.accountingPeriodKey.trim() || null, description: draft.description.trim() || null,
  };
}

export function validSavedLedgerEntry(value: unknown): value is SavedLedgerEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return ['id', 'source_system_id', 'external_entry_id', 'external_account_code', 'source_payload_hash', 'source_lineage_id'].every(key => typeof row[key] === 'string' && (row[key] as string).trim() !== '')
    && (row.source_payload_hash as string).length >= 32
    && ['external_journal_id', 'external_cost_centre_code', 'accounting_period_key', 'description'].every(key => row[key] === null || typeof row[key] === 'string')
    && typeof row.currency === 'string' && /^[A-Z]{3}$/.test(row.currency)
    && typeof row.amount_minor_units === 'string' && /^-?(0|[1-9]\d*)$/.test(row.amount_minor_units)
    && BigInt(row.amount_minor_units) >= BigInt('-9223372036854775808') && BigInt(row.amount_minor_units) <= BigInt('9223372036854775807')
    && isFinanceCalendarDate(row.transaction_date) && isFinanceAuditTimestamp(row.imported_at);
}

export function savedLedgerMatches(entry: SavedLedgerEntry, input: LedgerImportInput): boolean {
  return entry.source_system_id === input.sourceSystemId && entry.external_entry_id === input.externalEntryId
    && entry.external_account_code === input.externalAccountCode && entry.transaction_date === input.transactionDate
    && entry.currency === input.currency && entry.amount_minor_units === input.amountMinorUnits
    && entry.source_payload_hash === input.sourcePayloadHash && entry.source_lineage_id === input.sourceLineageId
    && entry.external_journal_id === input.externalJournalId && entry.external_cost_centre_code === input.externalCostCentreCode
    && entry.accounting_period_key === input.accountingPeriodKey && entry.description === input.description;
}
