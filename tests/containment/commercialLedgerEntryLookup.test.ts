import { beforeEach, describe, expect, it, vi } from 'vitest';
const sqlMock = vi.fn();
vi.mock('@/lib/db', () => ({ default: (...args: unknown[]) => sqlMock(...args) }));
const { getExternalGlEntryByIdentity, importExternalGlEntry } = await import('@/lib/commercial/externalGl');
beforeEach(() => sqlMock.mockReset());
describe('Read-only ledger identity lookup', () => {
  it('binds exact tenant, source and identity; selects text dates and cents without mutation', async () => {
    sqlMock.mockResolvedValue([{ id: 'entry' }]);
    expect(await getExternalGlEntryByIdentity('org-a', ' XERO ', "entry' OR true --")).toEqual({ id: 'entry' });
    const [strings, ...values] = sqlMock.mock.calls[0];
    expect(values).toEqual(['org-a','XERO',"entry' OR true --"]);
    const query = strings.join('?');
    expect(query).toContain('organisation_id=? AND source_system_id=? AND external_entry_id=?');
    expect(query).toContain('transaction_date::text'); expect(query).toContain('amount_minor_units::text');
    expect(query).not.toMatch(/INSERT|UPDATE|DELETE/);
  });
  it('returns null for a missing tenant-scoped entry', async () => {
    sqlMock.mockResolvedValue([]); expect(await getExternalGlEntryByIdentity('org-b','XERO','foreign-entry')).toBeNull();
  });
  it('rejects blank identities before querying', async () => {
    await expect(getExternalGlEntryByIdentity('org-a',' ','entry')).rejects.toThrow(); expect(sqlMock).not.toHaveBeenCalled();
  });
  it('rejects a short import evidence hash before a database constraint can produce a server error', async () => {
    await expect(importExternalGlEntry({ organisationId:'org-a',userId:'admin',sourceSystemId:'XERO',externalEntryId:'entry',externalAccountCode:'600',transactionDate:'2026-09-10',currency:'AUD',amountMinorUnits:'100',sourcePayloadHash:'short',sourceLineageId:'batch' })).rejects.toMatchObject({ code:'INVALID_INPUT' });
    expect(sqlMock).not.toHaveBeenCalled();
  });
});
