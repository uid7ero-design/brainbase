import type {
  AttendanceStatus,
  CancellationOutcome,
  CancellationRequest,
  CreateReservationResult,
  NewReservationInput,
  Reservation,
  ReservationRepository,
  TenantContext,
} from '../../src';
import type { ContractHarness } from './reservationRepositoryContract';

// TEST-ONLY reference implementation of ReservationRepository. It exists to
// prove the contract suite is satisfiable and to give later phases an
// executable definition of correct behaviour. It is not part of the package's
// public surface and is not an engine: it implements headcount capacity for
// occurrence spans only, which is all the contract exercises.

export class InMemoryReservationRepository implements ReservationRepository {
  private rows: Reservation[] = [];
  private seq = 0;
  private offerings = new Map<string, number>(); // `${org}|${offeringId}` -> capacity
  private occurrences = new Map<string, string>(); // `${org}|${occurrenceId}` -> offeringId

  seedOffering(tenant: TenantContext, offeringId: string, capacity: number) {
    this.offerings.set(`${tenant.organisationId}|${offeringId}`, capacity);
  }
  seedOccurrence(tenant: TenantContext, occurrenceId: string, offeringId: string) {
    this.occurrences.set(`${tenant.organisationId}|${occurrenceId}`, offeringId);
  }

  private mine(tenant: TenantContext): Reservation[] {
    return this.rows.filter(r => r.organisationId === tenant.organisationId);
  }

  async getById(tenant: TenantContext, id: string) {
    return this.mine(tenant).find(r => r.id === id) ?? null;
  }
  async listForOccurrence(tenant: TenantContext, occurrenceId: string) {
    return this.mine(tenant).filter(r => r.span.kind === 'occurrence' && r.span.occurrenceId === occurrenceId);
  }
  async listForCustomer(tenant: TenantContext, customerId: string) {
    return this.mine(tenant).filter(r => r.customerId === customerId);
  }

  // JavaScript runs this synchronously between awaits, which is the atomicity
  // the contract demands of the check-then-insert; a SQL implementation gets
  // the same guarantee from a row lock or constraint.
  async create(tenant: TenantContext, input: NewReservationInput): Promise<CreateReservationResult> {
    if (input.span.kind !== 'occurrence') return { ok: false, reason: 'offering_unavailable' };
    const org = tenant.organisationId;
    const capacity = this.offerings.get(`${org}|${input.offeringId}`);
    const occurrenceOffering = this.occurrences.get(`${org}|${input.span.occurrenceId}`);
    if (capacity === undefined || occurrenceOffering !== input.offeringId) return { ok: false, reason: 'not_found' };

    const live = this.mine(tenant).filter(
      r => r.span.kind === 'occurrence' && r.span.occurrenceId === (input.span as { occurrenceId: string }).occurrenceId && r.status !== 'cancelled',
    );
    if (live.some(r => r.customerId === input.customerId)) return { ok: false, reason: 'duplicate_reservation' };
    if (live.reduce((n, r) => n + r.partySize, 0) + input.partySize > capacity) return { ok: false, reason: 'capacity_exceeded' };

    const reservation: Reservation = {
      id: `res-${++this.seq}`,
      organisationId: org,
      offeringId: input.offeringId,
      resourceId: input.resourceId,
      customerId: input.customerId,
      participants: [],
      partySize: input.partySize,
      span: input.span,
      status: 'confirmed',
      attendance: null,
      paymentStatus: 'unpaid',
      price: input.price,
      seriesId: input.seriesId,
      notes: input.notes,
    };
    this.rows.push(reservation);
    return { ok: true, reservation };
  }

  async cancel(tenant: TenantContext, request: CancellationRequest): Promise<CancellationOutcome> {
    const row = this.mine(tenant).find(r => r.id === request.reservationId);
    if (!row) return { status: 'rejected', reason: 'not_found' };
    if (row.status === 'cancelled') return { status: 'rejected', reason: 'already_cancelled' };
    row.status = 'cancelled';
    return { status: 'cancelled', cancelledReservationIds: [row.id], charge: null };
  }

  async setAttendance(tenant: TenantContext, id: string, attendance: AttendanceStatus | null) {
    const row = this.mine(tenant).find(r => r.id === id);
    if (!row) return null;
    row.attendance = attendance;
    return row;
  }
}

export function makeInMemoryHarness(): ContractHarness {
  const repo = new InMemoryReservationRepository();
  return {
    repo,
    seedOffering: (t, id, cap) => repo.seedOffering(t, id, cap),
    seedOccurrence: (t, id, offering) => repo.seedOccurrence(t, id, offering),
  };
}
