import { describe, it, expect, beforeEach } from 'vitest';
import type {
  CreateReservationResult,
  PresetKey,
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

export interface SeedOfferingOptions {
  /** The schedule the offering belongs to; defaults to 'sched-1'. */
  scheduleId?: string;
  /** The preset of that schedule; defaults to 'classes_coaching'. */
  presetKey?: PresetKey;
}

export interface SeedOccurrenceOptions {
  /** Defaults to Australia/Adelaide and the window of newInput(). */
  timezone?: string;
  startsAt?: string;
  endsAt?: string;
}

export interface ContractHarness {
  repo: ReservationRepository;
  /**
   * Make an offering (and its schedule) exist for a tenant with a headcount capacity. Seeding an
   * existing offering again changes its capacity, including on occurrences already seeded.
   * May be asynchronous: a database-backed harness has to write rows.
   */
  seedOffering(tenant: TenantContext, offeringId: string, capacity: number, options?: SeedOfferingOptions): void | Promise<void>;
  seedOccurrence(tenant: TenantContext, occurrenceId: string, offeringId: string, options?: SeedOccurrenceOptions): void | Promise<void>;
}

export function newInput(over: Partial<NewReservationInput> = {}): NewReservationInput {
  return {
    offeringId: 'offering-1',
    resourceId: null,
    scheduleId: 'sched-1',
    presetKey: 'classes_coaching',
    presetVersion: 1,
    customerId: 'customer-1',
    customerSnapshot: { displayName: 'Customer', email: null, emailNormalised: null, phone: null },
    timezone: 'Australia/Adelaide',
    instants: { startsAt: '2026-12-07T05:30:00Z', endsAt: '2026-12-07T06:30:00Z' },
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

export function describeReservationRepositoryContract(name: string, make: () => ContractHarness | Promise<ContractHarness>) {
  describe(`ReservationRepository contract: ${name}`, () => {
    const a = tenantFor('org-a');
    const b = tenantFor('org-b');
    let h: ContractHarness;

    beforeEach(async () => {
      h = await make();
      for (const t of [a, b]) {
        await h.seedOffering(t, 'offering-1', 2);
        await h.seedOccurrence(t, 'occ-1', 'offering-1');
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
      await h.seedOffering(b, 'only-b-offering', 5);
      await h.seedOccurrence(b, 'only-b-occ', 'only-b-offering');
      const r = await h.repo.create(a, newInput({ offeringId: 'only-b-offering', span: { kind: 'occurrence', occurrenceId: 'only-b-occ' } }));
      expect(r).toEqual({ ok: false, reason: 'not_found' });
    });

    it('stores the booking-time snapshot verbatim: schedule, preset and version, customer, timezone and UTC window', async () => {
      const snapshot = { displayName: 'Sam Taylor', email: 'Sam@Example.com', emailNormalised: 'sam@example.com', phone: '0400 000 000' };
      const window = { startsAt: '2026-12-07T10:00:00Z', endsAt: '2026-12-07T11:30:00Z' };
      await h.seedOffering(a, 'offering-7', 5, { scheduleId: 'sched-7', presetKey: 'event_capacity' });
      await h.seedOccurrence(a, 'occ-7', 'offering-7', { timezone: 'Australia/Perth', ...window });
      const r = expectOk(await h.repo.create(a, newInput({
        offeringId: 'offering-7', scheduleId: 'sched-7', presetKey: 'event_capacity', presetVersion: 1, customerId: null,
        customerSnapshot: snapshot, timezone: 'Australia/Perth', instants: window,
        span: { kind: 'occurrence', occurrenceId: 'occ-7' },
      })));
      expect(r.scheduleId).toBe('sched-7');
      expect(r.presetKey).toBe('event_capacity');
      expect(r.customerId).toBeNull();
      expect(r.customerSnapshot).toEqual(snapshot);
      expect(r.timezone).toBe('Australia/Perth');
      expect(r.instants).toEqual(window);
    });

    it('an unlinked booking is a duplicate only on the same normalised email within the tenant, never on a name', async () => {
      const mk = (name: string, email: string | null) => newInput({
        customerId: null,
        customerSnapshot: { displayName: name, email, emailNormalised: email ? email.trim().toLowerCase() : null, phone: null },
      });
      expectOk(await h.repo.create(a, mk('Sam Taylor', 'sam@example.com')));
      // same name, different email: a different person
      expectOk(await h.repo.create(a, mk('Sam Taylor', 'other@example.com')));
      // no email at all, same name: cannot be matched, never merged
      await h.seedOffering(a, 'offering-1', 10);
      expectOk(await h.repo.create(a, mk('Sam Taylor', null)));
      expectOk(await h.repo.create(a, mk('Sam Taylor', null)));
      // same email, different case: the same person
      expect(await h.repo.create(a, mk('S. Taylor', ' SAM@example.com '))).toEqual({ ok: false, reason: 'duplicate_reservation' });
      // the same email in ANOTHER tenant is unrelated
      expectOk(await h.repo.create(b, mk('Sam Taylor', 'sam@example.com')));
    });
  });
}
