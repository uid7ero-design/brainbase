import { describe, it, expect, beforeEach } from 'vitest';
import type {
  CreateReservationResult,
  NewReservationInput,
  Reservation,
  ReservationRepository,
  TenantContext,
} from '../../src';

// Executable specification of the organisation-isolation behaviour every
// ReservationRepository must have. The in-memory reference implementation in
// this directory passes it now; the SQL-backed implementation added in a later
// phase must pass the SAME suite (run against a disposable database), so
// tenant isolation is proven against the real adapter instead of re-asserted.

export function tenantFor(organisationId: string, can: TenantContext['can'] = () => true): TenantContext {
  return { organisationId, timezone: 'Australia/Adelaide', actor: { kind: 'staff', userId: `user-of-${organisationId}` }, can };
}

export interface ContractHarness {
  repo: ReservationRepository;
  /** Make an offering exist for a tenant with a headcount capacity. */
  seedOffering(tenant: TenantContext, offeringId: string, capacity: number): void;
  seedOccurrence(tenant: TenantContext, occurrenceId: string, offeringId: string): void;
}

export function newInput(over: Partial<NewReservationInput> = {}): NewReservationInput {
  return {
    offeringId: 'offering-1',
    resourceId: null,
    customerId: 'customer-1',
    partySize: 1,
    span: { kind: 'occurrence', occurrenceId: 'occ-1' },
    price: { amountCents: 0, currency: 'AUD' },
    seriesId: null,
    notes: null,
    ...over,
  };
}

function expectOk(r: CreateReservationResult): Reservation {
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  return r.reservation;
}

export function describeReservationRepositoryContract(name: string, make: () => ContractHarness) {
  describe(`ReservationRepository contract: ${name}`, () => {
    const a = tenantFor('org-a');
    const b = tenantFor('org-b');
    let h: ContractHarness;

    beforeEach(() => {
      h = make();
      for (const t of [a, b]) {
        h.seedOffering(t, 'offering-1', 2);
        h.seedOccurrence(t, 'occ-1', 'offering-1');
      }
    });

    it('stamps every created reservation with the calling tenant, never anything else', async () => {
      const r = expectOk(await h.repo.create(a, newInput()));
      expect(r.organisationId).toBe('org-a');
    });

    it("getById cannot see another organisation's reservation, even with the exact id", async () => {
      const mine = expectOk(await h.repo.create(a, newInput()));
      expect(await h.repo.getById(a, mine.id)).not.toBeNull();
      expect(await h.repo.getById(b, mine.id)).toBeNull();
    });

    it("list queries return only the calling tenant's rows, even when ids collide across tenants", async () => {
      expectOk(await h.repo.create(a, newInput({ customerId: 'shared-customer-id' })));
      expectOk(await h.repo.create(b, newInput({ customerId: 'shared-customer-id' })));
      expect((await h.repo.listForOccurrence(a, 'occ-1')).map(r => r.organisationId)).toEqual(['org-a']);
      expect((await h.repo.listForOccurrence(b, 'occ-1')).map(r => r.organisationId)).toEqual(['org-b']);
      expect((await h.repo.listForCustomer(a, 'shared-customer-id')).map(r => r.organisationId)).toEqual(['org-a']);
    });

    it("cancel cannot touch another organisation's reservation and reports not_found", async () => {
      const mine = expectOk(await h.repo.create(a, newInput()));
      const out = await h.repo.cancel(b, { reservationId: mine.id, cancelledBy: 'staff', reason: null, scope: 'this_occurrence' });
      expect(out).toEqual({ status: 'rejected', reason: 'not_found' });
      expect((await h.repo.getById(a, mine.id))?.status).not.toBe('cancelled');
    });

    it("setAttendance cannot touch another organisation's reservation", async () => {
      const mine = expectOk(await h.repo.create(a, newInput()));
      expect(await h.repo.setAttendance(b, mine.id, 'attended')).toBeNull();
      expect((await h.repo.getById(a, mine.id))?.attendance).toBeNull();
    });

    it('capacity is counted per organisation: another tenant filling its own offering never blocks this one', async () => {
      expectOk(await h.repo.create(b, newInput({ customerId: 'b1' })));
      expectOk(await h.repo.create(b, newInput({ customerId: 'b2' })));
      expectOk(await h.repo.create(a, newInput({ customerId: 'a1' })));
      expectOk(await h.repo.create(a, newInput({ customerId: 'a2' })));
    });

    it('never overbooks: the third create against a capacity of 2 is refused', async () => {
      expectOk(await h.repo.create(a, newInput({ customerId: 'c1' })));
      expectOk(await h.repo.create(a, newInput({ customerId: 'c2' })));
      const third = await h.repo.create(a, newInput({ customerId: 'c3' }));
      expect(third).toEqual({ ok: false, reason: 'capacity_exceeded' });
    });

    it('never overbooks under concurrent creates (the check and the insert are one atomic step)', async () => {
      const results = await Promise.all(
        ['c1', 'c2', 'c3', 'c4', 'c5'].map(id => h.repo.create(a, newInput({ customerId: id }))),
      );
      expect(results.filter(r => r.ok)).toHaveLength(2);
      expect(results.filter(r => !r.ok && r.reason === 'capacity_exceeded')).toHaveLength(3);
    });

    it('a cancelled reservation frees its place', async () => {
      const first = expectOk(await h.repo.create(a, newInput({ customerId: 'c1' })));
      expectOk(await h.repo.create(a, newInput({ customerId: 'c2' })));
      await h.repo.cancel(a, { reservationId: first.id, cancelledBy: 'staff', reason: null, scope: 'this_occurrence' });
      expectOk(await h.repo.create(a, newInput({ customerId: 'c3' })));
    });

    it('refuses the same customer twice on the same occurrence', async () => {
      expectOk(await h.repo.create(a, newInput({ customerId: 'c1' })));
      expect(await h.repo.create(a, newInput({ customerId: 'c1' }))).toEqual({ ok: false, reason: 'duplicate_reservation' });
    });

    it("an offering or occurrence that belongs to another organisation does not exist for this one", async () => {
      h.seedOffering(b, 'only-b-offering', 5);
      h.seedOccurrence(b, 'only-b-occ', 'only-b-offering');
      const r = await h.repo.create(a, newInput({ offeringId: 'only-b-offering', span: { kind: 'occurrence', occurrenceId: 'only-b-occ' } }));
      expect(r).toEqual({ ok: false, reason: 'not_found' });
    });
  });
}
