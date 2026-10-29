import { describe, it, expect } from 'vitest';
import { staffTenantContext, publicTenantContext } from '@/lib/scheduling/adapters/brainbase';
import { findOrCreateCrmContact, normaliseEmail, resolveCrmLinkError, CrmLinkError, type ContactSqlExecutor } from '@/lib/scheduling/crmLink';

// Phase 2B.0 — the typed wrapper around the CRM find-or-create function, against a recording fake executor.
// The SQL function itself is proven on real Postgres (scripts/tests/schedulingHost2b0.integration.test.ts).

type Call = { text: string; params: readonly unknown[] };
function fake(reply: (call: Call) => unknown): { db: ContactSqlExecutor; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    db: {
      async query<Row>(text: string, params: readonly unknown[] = []) {
        const call = { text, params };
        calls.push(call);
        const out = reply(call);
        if (out instanceof Error || (typeof out === 'object' && out !== null && 'code' in out && !Array.isArray(out))) throw out;
        return out as Row[];
      },
    },
  };
}
const dbError = (code: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(`pg ${code}`), { code }, extra);
const tenant = (role = 'manager') => staffTenantContext({ organisationId: 'org-a', userId: 'user-1', role, timezone: null });
const created = [{ contact_id: 'c-1', outcome: 'created' }];

describe('normaliseEmail mirrors the SQL rule (lower(btrim), one @, no whitespace, at most 254)', () => {
  it('accepts and normalises', () => {
    expect(normaliseEmail('  Sam.Smith@Example.COM ')).toBe('sam.smith@example.com');
  });
  it.each([null, undefined, '', '   ', 'no-at-sign', 'a@b@c', 'sp ace@x.com', '@x.com', 'x@', `${'a'.repeat(250)}@x.co`])('rejects %j', v => {
    expect(normaliseEmail(v as string | null | undefined)).toBeNull();
  });
});

describe('findOrCreateCrmContact', () => {
  it('takes the organisation and user from the tenant, never from the input', async () => {
    const { db, calls } = fake(() => created);
    const sneaky = { email: 'sam@example.com', firstName: 'Sam', lastName: 'Lee', organisationId: 'org-attacker', created_by: 'attacker' } as never;
    const r = await findOrCreateCrmContact(db, tenant(), sneaky);
    expect(r).toEqual({ kind: 'linked', contactId: 'c-1', outcome: 'created' });
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual(['org-a', 'sam@example.com', 'Sam', 'Lee', null, 'user-1']);
    expect(calls[0].text).toMatch(/brainbase_scheduling_find_or_create_contact/);
  });

  it('passes names and email through unchanged: nothing is trimmed, split, derived or defaulted in TypeScript', async () => {
    const { db, calls } = fake(() => created);
    await findOrCreateCrmContact(db, tenant(), { email: ' Sam@Example.com ', firstName: '  Zoë  ', lastName: "O'Brien-Núñez ", phone: '0412 345 678' });
    expect(calls[0].params).toEqual(['org-a', ' Sam@Example.com ', '  Zoë  ', "O'Brien-Núñez ", '0412 345 678', 'user-1']);
  });

  it('reports a match without needing names', async () => {
    const { db, calls } = fake(() => [{ contact_id: 'c-9', outcome: 'matched' }]);
    const r = await findOrCreateCrmContact(db, tenant(), { email: 'sam@example.com' });
    expect(r).toEqual({ kind: 'linked', contactId: 'c-9', outcome: 'matched' });
    expect(calls[0].params.slice(2, 4)).toEqual([null, null]);
  });

  it('no usable email: unlinked, and the database is never called', async () => {
    const { db, calls } = fake(() => created);
    for (const email of [undefined, null, '', '  ', 'not-an-email']) {
      expect(await findOrCreateCrmContact(db, tenant(), { email, firstName: 'Sam', lastName: 'Lee' })).toEqual({ kind: 'unlinked', reason: 'email_required' });
    }
    expect(calls).toHaveLength(0);
  });

  it('blank structured names with no match: unlinked (the booking is not blocked), no contact invented', async () => {
    const { db, calls } = fake(() => dbError('SCCNM'));
    expect(await findOrCreateCrmContact(db, tenant(), { email: 'sam@example.com', firstName: 'Sam', lastName: '   ' })).toEqual({
      kind: 'unlinked',
      reason: 'names_required',
    });
    expect(calls).toHaveLength(1);
  });

  it('refuses every non-staff or non-reserving tenant before the database is reached', async () => {
    const { db, calls } = fake(() => created);
    const refused = [publicTenantContext('org-a', null), tenant('viewer'), tenant('analyst'), tenant('unknown-role')];
    for (const t of refused) {
      await expect(findOrCreateCrmContact(db, t, { email: 'sam@example.com', firstName: 'Sam', lastName: 'Lee' })).rejects.toMatchObject({ name: 'CrmLinkError', reason: 'forbidden' });
    }
    const customer = { ...tenant(), actor: { kind: 'customer', customerId: 'c1' } } as never;
    await expect(findOrCreateCrmContact(db, customer, { email: 'sam@example.com' })).rejects.toBeInstanceOf(CrmLinkError);
    expect(calls).toHaveLength(0);
  });

  it('maps database errors: lock timeout is retryable, foreign key and isolation errors are named, others pass through', async () => {
    const run = (e: unknown) => findOrCreateCrmContact(fake(() => e as never).db, tenant(), { email: 'sam@example.com', firstName: 'Sam', lastName: 'Lee' });
    await expect(run(dbError('55P03', { message: 'canceling statement due to lock timeout' }))).rejects.toMatchObject({ reason: 'contention_timeout', retryable: true });
    await expect(run(dbError('23503', { constraint: 'crm_contacts_organisation_id_fkey' }))).rejects.toMatchObject({ reason: 'unknown_organisation', retryable: false });
    await expect(run(dbError('23503', { constraint: 'crm_contacts_created_by_fkey' }))).rejects.toMatchObject({ reason: 'unknown_user' });
    await expect(run(dbError('SCISO'))).rejects.toMatchObject({ reason: 'unsafe_isolation' });
    await expect(run(dbError('SCCOR'))).rejects.toMatchObject({ reason: 'organisation_required' });
    const unknown = dbError('40P01');
    await expect(run(unknown)).rejects.toBe(unknown);
    expect(resolveCrmLinkError(dbError('55P03', { message: 'could not obtain lock (NOWAIT)' }))).toBeNull();
    expect(resolveCrmLinkError(null)).toBeNull();
  });

  it('refuses an unusable result row', async () => {
    await expect(findOrCreateCrmContact(fake(() => []).db, tenant(), { email: 'sam@example.com', firstName: 'Sam', lastName: 'Lee' })).rejects.toThrow(/no usable row/);
    await expect(findOrCreateCrmContact(fake(() => [{ contact_id: 'c', outcome: 'weird' }]).db, tenant(), { email: 'sam@example.com', firstName: 'Sam', lastName: 'Lee' })).rejects.toThrow(/no usable row/);
  });
});
