import { describe, expect, it } from 'vitest';
import { prepareLedgerImport, savedLedgerMatches, signedLedgerAmountToCents, validSavedLedgerEntry } from '@/lib/commercial/externalGlImportDisplay';

import { ledgerDraft, savedEntry } from '../fixtures/commercialLedgerImport';

describe('Exact administrator ledger import preview', () => {
  it.each([['0','0'],['-0.00','0'],['-0.01','-1'],['1,234.5','123450'],['92233720368547758.07','9223372036854775807'],['-92233720368547758.08','-9223372036854775808']])('parses %s as exact cents %s', (input, cents) => expect(signedLedgerAmountToCents(input)).toBe(cents));
  it.each(['1.001','1e3','1,00.00','NaN','+1.00','92233720368547758.08','-92233720368547758.09'])('rejects invalid or out-of-range money %s', input => expect(() => signedLedgerAmountToCents(input)).toThrow());
  it('normalises date, currency, optional fields and exact signed amount without changing source data', () => {
    const input = prepareLedgerImport(ledgerDraft);
    expect(input).toMatchObject({ transactionDate: '2026-09-10', currency: 'AUD', amountMinorUnits: '-9007199254740993', externalJournalId: null });
    expect(ledgerDraft.transactionDate).toBe('10/09/2026'); expect(savedLedgerMatches(savedEntry, input)).toBe(true);
  });
  it.each(['sourceSystemId','externalEntryId','externalAccountCode','sourcePayloadHash','sourceLineageId'] as const)('requires original evidence field %s', field => expect(() => prepareLedgerImport({ ...ledgerDraft, [field]: ' ' })).toThrow());
  it('rejects an impossible Australian calendar date', () => expect(() => prepareLedgerImport({ ...ledgerDraft, transactionDate: '31/02/2026' })).toThrow());
  it('rejects a short evidence hash in both preview and saved receipt', () => {
    expect(() => prepareLedgerImport({ ...ledgerDraft, sourcePayloadHash: 'short' })).toThrow('at least 32');
    expect(validSavedLedgerEntry({ ...savedEntry, source_payload_hash: 'short' })).toBe(false);
  });
  it.each(['id','source_system_id','external_entry_id','external_account_code','source_payload_hash','source_lineage_id'] as const)('rejects an incomplete saved field %s', field => expect(validSavedLedgerEntry({ ...savedEntry, [field]: ' ' })).toBe(false));
  it.each([{ amount_minor_units: 100 }, { amount_minor_units: '9223372036854775808' }, { transaction_date: '2026-02-31' }, { imported_at: 'today' }, { description: undefined }])('rejects malformed saved evidence %j', change => expect(validSavedLedgerEntry({ ...savedEntry, ...change })).toBe(false));
  it('checks every immutable fact when confirming saved evidence', () => {
    const input = prepareLedgerImport(ledgerDraft);
    for (const field of Object.keys(input) as Array<keyof typeof input>) expect(savedLedgerMatches(savedEntry, { ...input, [field]: input[field] === null ? 'different' : `${input[field]}x` })).toBe(false);
    expect(validSavedLedgerEntry(savedEntry)).toBe(true);
  });
});
