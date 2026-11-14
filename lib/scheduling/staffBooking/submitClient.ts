// Phase 2C.3c UI slice 2: the client side of POST /api/scheduling/reservations and the reconcile lookup GET /api/scheduling/reservations?idempotencyKey=.
// Pure of server imports. This is the ONLY file in the staff booking UI that sends a write.
//
// The rule that matters: a response is DEFINITIVE only when it is a success or one of the API's own stable refusal codes. Everything else
// (a network error, a timeout, a 5xx, an OUTCOME_UNKNOWN, an unparseable body, a success whose body is not a reservation, an unknown 4xx)
// is UNCERTAIN, because the booking may exist. Wording is fixed per code (never server text) and nothing here echoes a value.

export const SUBMIT_TIMEOUT_MS = 20_000;
export const LOOKUP_TIMEOUT_MS = 8_000;

export interface CreateBody {
  offeringId: string;
  resourceId: string;
  start: { date: string; time: string };
  durationMinutes: number;
  partySize: number;
  customer: { name: string; email?: string; phone?: string };
  notes?: string;
  basis: { offeringVersion: string; resourceVersion: string; offeringToken: string; scheduleToken: string };
}

export interface BookedReservation {
  id: string;
  status: string;
  offeringId: string;
  resourceId: string;
  timezone: string;
  start: { date: string; time: string } | null;
  durationMinutes: number | null;
  startsAt: string;
  endsAt: string;
  partySize: number;
  customer: { name: string; email: string | null; phone: string | null };
  notes: string | null;
  price: { amountCents: number; currency: string } | null;
  paymentStatus: string;
}

/** The refusal codes the API documents for the create call. Each means the booking was NOT made. */
export const DEFINITIVE_CODES = [
  'VALIDATION',
  'DURATION_NOT_ALLOWED',
  'OFFERING_NOT_BOOKABLE',
  'NONEXISTENT_LOCAL_TIME',
  'RESOURCE_NOT_ELIGIBLE',
  'IDEMPOTENCY_CONFLICT',
  'NOT_FOUND',
  'OFFERING_UNAVAILABLE',
  'RESOURCE_INACTIVE',
  'OUTSIDE_AVAILABILITY',
  'OFF_GRID',
  'IN_THE_PAST',
  'RESOURCE_CONFLICT',
  'PARTY_NOT_ALLOWED',
  'AVAILABILITY_CHANGED',
  'CONTENTION_TIMEOUT',
  'BOOKING_NOT_READY',
] as const;
export type DefinitiveCode = (typeof DEFINITIVE_CODES)[number];
const DEFINITIVE = new Set<string>(DEFINITIVE_CODES);

export type SubmitOutcome =
  | { kind: 'created'; reservation: BookedReservation; replayed: boolean; recovered: boolean }
  | { kind: 'refused'; code: DefinitiveCode; problems: string[] }
  | { kind: 'gate_off' }
  | { kind: 'denied' }
  | { kind: 'uncertain' };

export type LookupOutcome = { kind: 'found'; reservation: BookedReservation } | { kind: 'missing' } | { kind: 'error' };

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A reservation body is trusted only when every field the confirmation shows has the right type. */
export function asReservation(v: unknown): BookedReservation | null {
  if (!isObject(v)) return null;
  const c = v.customer;
  if (typeof v.id !== 'string' || v.id.length === 0 || typeof v.resourceId !== 'string' || typeof v.offeringId !== 'string') return null;
  if (typeof v.startsAt !== 'string' || typeof v.endsAt !== 'string' || typeof v.timezone !== 'string' || typeof v.partySize !== 'number') return null;
  if (!isObject(c) || typeof c.name !== 'string') return null;
  const start = isObject(v.start) && typeof v.start.date === 'string' && typeof v.start.time === 'string' ? { date: v.start.date, time: v.start.time } : null;
  const price = isObject(v.price) && typeof v.price.amountCents === 'number' && typeof v.price.currency === 'string' ? { amountCents: v.price.amountCents, currency: v.price.currency } : null;
  return {
    id: v.id,
    status: typeof v.status === 'string' ? v.status : 'confirmed',
    offeringId: v.offeringId,
    resourceId: v.resourceId,
    timezone: v.timezone,
    start,
    durationMinutes: typeof v.durationMinutes === 'number' ? v.durationMinutes : null,
    startsAt: v.startsAt,
    endsAt: v.endsAt,
    partySize: v.partySize,
    customer: { name: c.name, email: typeof c.email === 'string' ? c.email : null, phone: typeof c.phone === 'string' ? c.phone : null },
    notes: typeof v.notes === 'string' ? v.notes : null,
    price,
    paymentStatus: typeof v.paymentStatus === 'string' ? v.paymentStatus : 'unpaid',
  };
}

/** Pure: what a create response MEANS. Anything not provably a success or a documented refusal is uncertain. */
export function classifyCreate(status: number, body: unknown): SubmitOutcome {
  const b = isObject(body) ? body : {};
  const code = typeof b.code === 'string' ? b.code : '';
  if (status === 200 || status === 201) {
    const reservation = asReservation(b.reservation);
    return reservation ? { kind: 'created', reservation, replayed: b.replayed === true, recovered: b.recovered === true } : { kind: 'uncertain' };
  }
  if (status === 401 || status === 403) return { kind: 'denied' };
  if (status === 404 && code === '') return { kind: 'gate_off' };
  if (code === 'OUTCOME_UNKNOWN') return { kind: 'uncertain' };
  if (status >= 400 && status < 600 && DEFINITIVE.has(code)) {
    const problems = Array.isArray(b.problems) ? b.problems.filter((p): p is string => typeof p === 'string') : [];
    return { kind: 'refused', code: code as DefinitiveCode, problems };
  }
  return { kind: 'uncertain' };
}

export function classifyLookup(status: number, body: unknown): LookupOutcome {
  if (status === 200) {
    const reservation = asReservation(isObject(body) ? body.reservation : null);
    return reservation ? { kind: 'found', reservation } : { kind: 'error' };
  }
  if (status === 404) return { kind: 'missing' };
  return { kind: 'error' };
}

async function send(url: string, init: RequestInit, timeoutMs: number, outer?: AbortSignal): Promise<{ status: number; body: unknown } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuter = () => controller.abort();
  outer?.addEventListener('abort', onOuter);
  try {
    const res = await fetch(url, { ...init, credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
    const body: unknown = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch {
    return null; // a network error, a timeout or an abort: the request may or may not have been processed
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuter);
  }
}

/** The one write. `key` is the held idempotency key, sent in the header and nowhere else; the same key and the same body on every retry. */
export async function postReservation(body: CreateBody, key: string, outer?: AbortSignal): Promise<SubmitOutcome> {
  const res = await send('/api/scheduling/reservations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) }, SUBMIT_TIMEOUT_MS, outer);
  return res ? classifyCreate(res.status, res.body) : { kind: 'uncertain' };
}

/** The reconcile lookup (read only): the booking created under this key, if any. */
export async function lookupReservation(key: string, outer?: AbortSignal): Promise<LookupOutcome> {
  const res = await send(`/api/scheduling/reservations?idempotencyKey=${encodeURIComponent(key)}`, { method: 'GET' }, LOOKUP_TIMEOUT_MS, outer);
  return res ? classifyLookup(res.status, res.body) : { kind: 'error' };
}
