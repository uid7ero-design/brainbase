import { describe, expect, it } from 'vitest';
import { HIRE_EMAIL_MAX, HIRE_NAME_MAX, HIRE_NOTES_MAX, HIRE_PARTY_MAX, HIRE_PHONE_MAX } from '@scheduling/core';
import { createBookingKeyHolder } from '@/lib/scheduling/staffBooking/key';
import {
  EMAIL_MAX,
  NAME_MAX,
  NOTES_MAX,
  PARTY_MAX,
  PHONE_MAX,
  POLL_DELAYS_MS,
  RETURN_TO_TIME,
  UNCERTAIN_STEPS,
  bodyOf,
  contentOf,
  createMachine,
  UNCONFIRMED_NOTE,
  initialState,
  provableNotBooked,
  validateDetails,
  type Action,
  type Details,
  type MachineState,
  type Target,
} from '@/lib/scheduling/staffBooking/machine';
import { DEFINITIVE_CODES, asReservation, classifyCreate, classifyLookup, type BookedReservation, type SubmitOutcome } from '@/lib/scheduling/staffBooking/submitClient';

// Phase 2C.3c UI slice 2: the booking state machine (pure). The central claim: NO sequence of uncertain outcomes (or of anything else) generates, changes or sends a
// different idempotency key for the same intended booking, and nothing during an uncertain outcome can change the booking or step back to "not booked".

const TARGET: Target = {
  offeringId: 'off-1',
  offeringName: 'Court hire',
  resourceId: 'court-1',
  resourceName: 'Court 1',
  date: '2027-01-11',
  time: '10:00',
  startsAt: '2027-01-10T23:30:00.000Z',
  durationMinutes: 60,
  timezone: 'Australia/Adelaide',
  capacity: 4,
  price: { amountCents: 5000, currency: 'AUD' },
  basis: { offeringVersion: '4', resourceVersion: '6', offeringToken: 'o', scheduleToken: 's' },
};
const DETAILS: Details = { name: ' Pat Customer ', email: 'pat@example.test', phone: '0400 000 000', partySize: '2', notes: 'Bring a ball hopper' };

const reservation = (over: Partial<BookedReservation> = {}): BookedReservation => ({
  id: 'res-0123456789abcdef0123456789abcdef',
  status: 'confirmed',
  offeringId: 'off-1',
  resourceId: 'court-1',
  timezone: 'Australia/Adelaide',
  start: { date: '2027-01-11', time: '10:00' },
  durationMinutes: 60,
  startsAt: TARGET.startsAt,
  endsAt: '2027-01-11T00:30:00.000Z',
  partySize: 2,
  customer: { name: 'Pat Customer', email: 'pat@example.test', phone: '0400 000 000' },
  notes: 'Bring a ball hopper',
  price: { amountCents: 5000, currency: 'AUD' },
  paymentStatus: 'unpaid',
  ...over,
});

function harness() {
  let minted = 0;
  const holder = createBookingKeyHolder(() => `${String(++minted).padStart(8, '0')}-0000-0000-0000-000000000000`);
  const reduce = createMachine(holder);
  let state = initialState();
  const send = (a: Action) => (state = reduce(state, a));
  const fill = (d: Partial<Details> = {}) => {
    for (const [field, value] of Object.entries({ ...DETAILS, ...d })) send({ type: 'FIELD', field: field as keyof Details, value });
  };
  const toReview = (d: Partial<Details> = {}) => {
    send({ type: 'START', target: TARGET });
    fill(d);
    send({ type: 'REVIEW' });
  };
  return { holder, send, fill, toReview, minted: () => minted, get state() { return state; } };
}

describe('limits agree with the API', () => {
  it('the client-side limits equal the core limits the server enforces', () => {
    expect([NAME_MAX, EMAIL_MAX, PHONE_MAX, NOTES_MAX, PARTY_MAX]).toEqual([HIRE_NAME_MAX, HIRE_EMAIL_MAX, HIRE_PHONE_MAX, HIRE_NOTES_MAX, HIRE_PARTY_MAX]);
  });
});

describe('customer details validation', () => {
  it('needs a name and a party size inside the capacity; email, phone and notes are optional but bounded', () => {
    expect(Object.keys(validateDetails({ name: '', email: '', phone: '', partySize: '1', notes: '' }, 4))).toEqual(['name']);
    expect(Object.keys(validateDetails({ name: 'A', email: '', phone: '', partySize: '5', notes: '' }, 4))).toEqual(['partySize']);
    expect(Object.keys(validateDetails({ name: 'A', email: '', phone: '', partySize: '0', notes: '' }, 4))).toEqual(['partySize']);
    expect(Object.keys(validateDetails({ name: 'A', email: '', phone: '', partySize: '1.5', notes: '' }, 4))).toEqual(['partySize']);
    expect(Object.keys(validateDetails({ name: 'A', email: 'nope', phone: 'abc', partySize: '1', notes: 'x'.repeat(NOTES_MAX + 1) }, 4)).sort()).toEqual(['email', 'notes', 'phone']);
    expect(validateDetails({ name: 'A', email: '', phone: '', partySize: '4', notes: 'x'.repeat(NOTES_MAX) }, 4)).toEqual({});
    expect(validateDetails({ name: 'x'.repeat(NAME_MAX + 1), email: '', phone: '', partySize: '1', notes: '' }, 4).name).toBeTruthy();
    expect(validateDetails({ name: 'A\u0007', email: '', phone: '', partySize: '1', notes: '' }, 4).name).toBeTruthy();
  });
  it('error messages never echo a typed value', () => {
    const e = validateDetails({ name: '', email: 'SECRET-VALUE@', phone: 'SECRET-PHONE', partySize: 'SECRET', notes: '' }, 4);
    expect(JSON.stringify(e)).not.toMatch(/SECRET/);
  });
  it('trims, and omits empty optional fields from the body', () => {
    const body = bodyOf(TARGET, { name: ' Pat ', email: '  ', phone: '', partySize: ' 3 ', notes: '' });
    expect(body).toEqual({ offeringId: 'off-1', resourceId: 'court-1', start: { date: '2027-01-11', time: '10:00' }, durationMinutes: 60, partySize: 3, customer: { name: 'Pat' }, basis: TARGET.basis });
    expect(Object.keys(bodyOf(TARGET, DETAILS)).sort()).toEqual(['basis', 'customer', 'durationMinutes', 'notes', 'offeringId', 'partySize', 'resourceId', 'start']);
  });
});

describe('the happy path and the guards', () => {
  it('details -> review -> submitting -> done, with one key', () => {
    const h = harness();
    h.toReview();
    expect(h.state.step).toBe('review');
    expect(h.minted()).toBe(1);
    h.send({ type: 'SUBMIT' });
    expect(h.state.step).toBe('submitting');
    expect(h.state.attempt?.key).toMatch(/^bk_0{7}1/);
    expect(h.state.sends).toBe(1);
    h.send({ type: 'RESPONSE', outcome: { kind: 'created', reservation: reservation(), replayed: false, recovered: false } });
    expect(h.state.step).toBe('done');
    expect(h.state.mismatch).toBe(false);
    expect(h.minted()).toBe(1);
  });

  it('a validation failure stays on the details step with errors and does not mint a key', () => {
    const h = harness();
    h.toReview({ name: '' });
    expect(h.state.step).toBe('details');
    expect(h.state.errors.name).toBeTruthy();
    expect(h.state.errorTick).toBe(1);
    expect(h.minted()).toBe(0);
  });

  it('a double submission (a second SUBMIT) starts no second send', () => {
    const h = harness();
    h.toReview();
    h.send({ type: 'SUBMIT' });
    const before = h.state;
    h.send({ type: 'SUBMIT' });
    h.send({ type: 'SUBMIT' });
    expect(h.state).toBe(before);
    expect(h.state.sends).toBe(1);
  });

  it('going back from review and forward again with the SAME content keeps the key; a changed party size makes a new one', () => {
    const h = harness();
    h.toReview();
    const key = h.state.reviewKey;
    h.send({ type: 'BACK' });
    h.send({ type: 'REVIEW' });
    expect(h.state.reviewKey).toBe(key);
    expect(h.minted()).toBe(1);
    h.send({ type: 'BACK' });
    h.send({ type: 'FIELD', field: 'partySize', value: '3' });
    h.send({ type: 'REVIEW' });
    expect(h.state.reviewKey).not.toBe(key);
    expect(h.minted()).toBe(2);
  });
});

describe('uncertain outcomes never change the key', () => {
  const uncertain: SubmitOutcome = { kind: 'uncertain' };

  it('submit -> uncertain -> checking: the lookups use the original key, nothing is minted, and nothing can edit the booking', () => {
    const h = harness();
    h.toReview();
    h.send({ type: 'SUBMIT' });
    const key = h.state.attempt!.key;
    h.send({ type: 'RESPONSE', outcome: uncertain });
    expect(h.state.step).toBe('checking');
    const frozen = h.state;
    for (const a of [
      { type: 'FIELD', field: 'name', value: 'Someone else' },
      { type: 'REVIEW' },
      { type: 'BACK' },
      { type: 'START', target: { ...TARGET, time: '11:00' } },
      { type: 'SUBMIT' },
      { type: 'RETRY' },
      { type: 'NEW_ATTEMPT' },
    ] as Action[]) {
      expect(h.send(a)).toBe(frozen);
    }
    expect(h.minted()).toBe(1);
    expect(h.holder.current()).toBe(key);
  });

  it('walks the bounded reconcile schedule 0.5 / 1.5 / 3 / 6 s, then offers only a same-key retry', () => {
    expect([...POLL_DELAYS_MS]).toEqual([500, 1500, 3000, 6000]);
    const h = harness();
    h.toReview();
    h.send({ type: 'SUBMIT' });
    h.send({ type: 'RESPONSE', outcome: uncertain });
    for (let i = 0; i < POLL_DELAYS_MS.length - 1; i += 1) {
      expect(h.state.step).toBe('checking');
      expect(h.state.poll).toBe(i);
      h.send({ type: 'POLL', outcome: { kind: 'missing' } });
    }
    h.send({ type: 'POLL', outcome: { kind: 'error' } }); // a failed lookup proves nothing either
    expect(h.state.step).toBe('unsure');
    const key = h.state.attempt!.key;
    const body = h.state.attempt!.body;
    h.send({ type: 'RETRY' });
    expect(h.state.step).toBe('submitting');
    expect(h.state.attempt!.key).toBe(key);
    expect(h.state.attempt!.body).toBe(body); // the very same frozen payload
    expect(h.state.sends).toBe(2);
    expect(h.minted()).toBe(1);
  });

  it('a lookup that finds the booking ends in the same confirmation as a normal booking', () => {
    const h = harness();
    h.toReview();
    h.send({ type: 'SUBMIT' });
    h.send({ type: 'RESPONSE', outcome: uncertain });
    h.send({ type: 'POLL', outcome: { kind: 'missing' } });
    h.send({ type: 'POLL', outcome: { kind: 'found', reservation: reservation() } });
    expect(h.state.step).toBe('done');
    expect(h.state.reservation?.id).toBe(reservation().id);
    expect(h.state.mismatch).toBe(false);
    // a different booking found under the key is shown as such
    const g = harness();
    g.toReview();
    g.send({ type: 'SUBMIT' });
    g.send({ type: 'RESPONSE', outcome: uncertain });
    g.send({ type: 'POLL', outcome: { kind: 'found', reservation: reservation({ start: { date: '2027-01-11', time: '11:00' } }) } });
    expect(g.state.step).toBe('done');
    expect(g.state.mismatch).toBe(true);
  });

  it('a retry that is again uncertain goes back to checking with the same key', () => {
    const h = harness();
    h.toReview();
    h.send({ type: 'SUBMIT' });
    const key = h.state.attempt!.key;
    h.send({ type: 'RESPONSE', outcome: uncertain });
    for (let i = 0; i < 4; i += 1) h.send({ type: 'POLL', outcome: { kind: 'missing' } });
    for (let round = 0; round < 3; round += 1) {
      h.send({ type: 'RETRY' });
      h.send({ type: 'RESPONSE', outcome: uncertain });
      expect(h.state.step).toBe('checking');
      expect(h.state.attempt!.key).toBe(key);
      for (let i = 0; i < 4; i += 1) h.send({ type: 'POLL', outcome: { kind: 'error' } });
      expect(h.state.step).toBe('unsure');
    }
    expect(h.minted()).toBe(1);
  });

  it('CONTENTION_TIMEOUT is a known "nothing was written": the same-key retry is offered', () => {
    const h = harness();
    h.toReview();
    h.send({ type: 'SUBMIT' });
    h.send({ type: 'RESPONSE', outcome: { kind: 'refused', code: 'CONTENTION_TIMEOUT', problems: [] } });
    expect(h.state.step).toBe('retry');
    const key = h.state.attempt!.key;
    h.send({ type: 'RETRY' });
    expect(h.state.attempt!.key).toBe(key);
    expect(h.minted()).toBe(1);
  });
});

describe('definitive refusals', () => {
  const refuse = (h: ReturnType<typeof harness>, code: (typeof DEFINITIVE_CODES)[number], problems: string[] = []) => {
    h.toReview();
    h.send({ type: 'SUBMIT' });
    h.send({ type: 'RESPONSE', outcome: { kind: 'refused', code, problems } });
  };

  it('AVAILABILITY_CHANGED returns to time selection, keeps the customer details, asks for a refetch and remembers the start to preselect', () => {
    const h = harness();
    refuse(h, 'AVAILABILITY_CHANGED');
    expect(h.state.step).toBe('idle');
    expect(h.state.details).toEqual(DETAILS);
    expect(h.state.refetch).toBe(1);
    expect(h.state.preferTime).toEqual({ date: '2027-01-11', time: '10:00' });
    expect(h.state.notice).toMatch(/available times changed/i);
    expect(h.state.attempt).toBeNull();
    // choosing a time again keeps the details
    h.send({ type: 'START', target: TARGET });
    expect(h.state.step).toBe('details');
    expect(h.state.details).toEqual(DETAILS);
  });

  it('RESOURCE_CONFLICT returns to time selection with "just taken", never preselecting the taken time', () => {
    const h = harness();
    refuse(h, 'RESOURCE_CONFLICT');
    expect(h.state.step).toBe('idle');
    expect(h.state.notice).toMatch(/just taken/i);
    expect(h.state.preferTime).toBeNull();
    expect(h.state.refetch).toBe(1);
    expect(h.state.details).toEqual(DETAILS);
  });

  it('every "time no longer bookable" code has fixed wording and returns to selection saying nothing was booked', () => {
    for (const [code, text] of Object.entries(RETURN_TO_TIME)) {
      const h = harness();
      refuse(h, code as (typeof DEFINITIVE_CODES)[number]);
      expect(h.state.step).toBe('idle');
      expect(text).toMatch(/Nothing was booked|just taken|available times changed/);
      expect(h.state.notice).toBe(text);
    }
  });

  it('VALIDATION maps the server field names to the form and echoes no value', () => {
    const h = harness();
    refuse(h, 'VALIDATION', ['customer.email', 'partySize', 'customer.phone']);
    expect(h.state.step).toBe('details');
    expect(Object.keys(h.state.errors).sort()).toEqual(['email', 'partySize', 'phone']);
    expect(JSON.stringify(h.state.errors)).not.toContain('pat@example.test');
    expect(h.state.errorTick).toBe(1);
    const g = harness();
    refuse(g, 'VALIDATION', ['request']);
    expect(g.state.notice).toMatch(/not accepted/);
  });

  it('PARTY_NOT_ALLOWED lands on the party size field', () => {
    const h = harness();
    refuse(h, 'PARTY_NOT_ALLOWED');
    expect(h.state.step).toBe('details');
    expect(h.state.errors.partySize).toMatch(/4/);
  });

  it('IDEMPOTENCY_CONFLICT is never overwritten: only an explicit NEW_ATTEMPT (from that state) discards the key', () => {
    const h = harness();
    refuse(h, 'IDEMPOTENCY_CONFLICT');
    expect(h.state.step).toBe('conflict');
    const key = h.state.attempt!.key;
    for (const a of [{ type: 'RETRY' }, { type: 'SUBMIT' }, { type: 'REVIEW' }, { type: 'BACK' }] as Action[]) h.send(a);
    expect(h.state.step).toBe('conflict');
    expect(h.holder.current()).toBe(key);
    h.send({ type: 'CONFLICT_LOOKUP', outcome: { kind: 'found', reservation: reservation() } });
    expect(h.state.conflictFound?.id).toBe(reservation().id);
    h.send({ type: 'NEW_ATTEMPT' });
    expect(h.state.step).toBe('idle');
    expect(h.holder.current()).toBeNull();
    h.send({ type: 'START', target: TARGET });
    h.send({ type: 'REVIEW' });
    expect(h.state.reviewKey).not.toBe(key);
    expect(h.minted()).toBe(2);
  });

  it('BOOKING_NOT_READY, a gate closing (404) and a denial end the flow with nothing booked and no retry', () => {
    for (const outcome of [{ kind: 'refused', code: 'BOOKING_NOT_READY', problems: [] }, { kind: 'gate_off' }, { kind: 'denied' }] as SubmitOutcome[]) {
      const h = harness();
      h.toReview();
      h.send({ type: 'SUBMIT' });
      h.send({ type: 'RESPONSE', outcome });
      expect(['unavailable', 'denied']).toContain(h.state.step);
      const frozen = h.state;
      expect(h.send({ type: 'RETRY' })).toBe(frozen);
      expect(h.send({ type: 'SUBMIT' })).toBe(frozen);
    }
  });
});

describe('response classification', () => {
  const body = (over: object = {}) => ({ reservation: reservation(), replayed: false, ...over });
  it('201, 200 replay and 201 recovered are successes with the reservation', () => {
    expect(classifyCreate(201, body())).toMatchObject({ kind: 'created', replayed: false, recovered: false });
    expect(classifyCreate(200, body({ replayed: true }))).toMatchObject({ kind: 'created', replayed: true });
    expect(classifyCreate(201, body({ recovered: true }))).toMatchObject({ kind: 'created', recovered: true });
  });
  it('a success whose body is not a reservation is UNCERTAIN, not a success and not a failure', () => {
    expect(classifyCreate(201, {})).toEqual({ kind: 'uncertain' });
    expect(classifyCreate(201, { reservation: { id: 5 } })).toEqual({ kind: 'uncertain' });
    expect(classifyCreate(200, null)).toEqual({ kind: 'uncertain' });
    expect(asReservation({ ...reservation(), customer: null })).toBeNull();
  });
  it('OUTCOME_UNKNOWN, every 5xx, a bare 500, an unparseable body and unknown codes are uncertain', () => {
    expect(classifyCreate(504, { code: 'OUTCOME_UNKNOWN' })).toEqual({ kind: 'uncertain' });
    expect(classifyCreate(500, null)).toEqual({ kind: 'uncertain' });
    expect(classifyCreate(502, { error: 'Bad gateway' })).toEqual({ kind: 'uncertain' });
    expect(classifyCreate(503, {})).toEqual({ kind: 'uncertain' });
    expect(classifyCreate(400, {})).toEqual({ kind: 'uncertain' }); // a 4xx without one of OUR codes is not proof
    expect(classifyCreate(409, { code: 'SOMETHING_NEW' })).toEqual({ kind: 'uncertain' });
    expect(classifyCreate(429, { code: 'RATE' })).toEqual({ kind: 'uncertain' });
  });
  it('the documented codes are definitive; 404 without a code is a closed gate; 401 and 403 are denied', () => {
    for (const code of DEFINITIVE_CODES) expect(classifyCreate(409, { code })).toMatchObject({ kind: 'refused', code });
    expect(classifyCreate(404, { error: 'not_found' })).toEqual({ kind: 'gate_off' });
    expect(classifyCreate(404, { code: 'NOT_FOUND' })).toMatchObject({ kind: 'refused', code: 'NOT_FOUND' });
    expect(classifyCreate(401, {})).toEqual({ kind: 'denied' });
    expect(classifyCreate(403, { code: 'FORBIDDEN' })).toEqual({ kind: 'denied' });
    expect(classifyCreate(400, { code: 'VALIDATION', problems: ['customer.name', 7] })).toEqual({ kind: 'refused', code: 'VALIDATION', problems: ['customer.name'] });
  });
  it('the lookup: 200 found, 404 missing, anything else is an error (still unproven)', () => {
    expect(classifyLookup(200, { reservation: reservation() }).kind).toBe('found');
    expect(classifyLookup(404, { error: 'not_found' })).toEqual({ kind: 'missing' });
    expect(classifyLookup(500, null)).toEqual({ kind: 'error' });
    expect(classifyLookup(200, {})).toEqual({ kind: 'error' });
  });
});

// ── the property test: no sequence of anything generates or sends a different key for the same intended booking ──────────────────────

function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('no sequence of outcomes can send a different key (property test)', () => {
  const OUTCOMES: SubmitOutcome[] = [
    { kind: 'created', reservation: reservation(), replayed: false, recovered: false },
    { kind: 'created', reservation: reservation(), replayed: true, recovered: true },
    { kind: 'uncertain' },
    { kind: 'uncertain' },
    { kind: 'uncertain' },
    { kind: 'gate_off' },
    { kind: 'denied' },
    ...DEFINITIVE_CODES.map(code => ({ kind: 'refused', code, problems: ['customer.name'] }) as SubmitOutcome),
  ];
  const FIELDS = ['name', 'email', 'phone', 'partySize', 'notes'] as const;
  const VALUES = ['', 'Pat', 'pat@example.test', 'bad', '1', '2', '3', '9', '0400 000 000', 'note'];

  it('across 3,000 random sequences of 80 actions', () => {
    const rand = prng(20261108);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
    let sendsSeen = 0;
    let uncertainSeen = 0;
    for (let run = 0; run < 3000; run += 1) {
      let minted = 0;
      const holder = createBookingKeyHolder(() => `${String(++minted).padStart(8, '0')}-0000-0000-0000-000000000000`);
      const reduce = createMachine(holder);
      let state: MachineState = initialState();
      let episode: { key: string; body: unknown; mintedAtStart: number } | null = null;
      let lastSends = 0;
      const targets = [TARGET, { ...TARGET, time: '11:00', startsAt: '2027-01-11T00:30:00.000Z' }];

      for (let i = 0; i < 80; i += 1) {
        const action: Action = pick<Action>([
          { type: 'START', target: pick(targets) },
          { type: 'FIELD', field: pick(FIELDS), value: pick(VALUES) },
          { type: 'REVIEW' },
          { type: 'REVIEW' },
          { type: 'BACK' },
          { type: 'SUBMIT' },
          { type: 'SUBMIT' },
          { type: 'RESPONSE', outcome: pick(OUTCOMES) },
          { type: 'RESPONSE', outcome: { kind: 'uncertain' } },
          { type: 'POLL', outcome: pick([{ kind: 'missing' }, { kind: 'error' }, { kind: 'found', reservation: reservation() }] as const) },
          { type: 'POLL', outcome: { kind: 'missing' } },
          { type: 'RETRY' },
          { type: 'RETRY' },
          { type: 'CONFLICT_LOOKUP', outcome: { kind: 'missing' } },
          { type: 'NEW_ATTEMPT' },
        ]);
        if (rand() < 0.3) for (const [field, value] of Object.entries(DETAILS)) state = reduce(state, { type: 'FIELD', field: field as (typeof FIELDS)[number], value }); // reach review often
        const before = state;
        state = reduce(state, action);

        // 1. an episode starts when a SUBMIT leaves review; its key and body are frozen from that moment
        if (before.step === 'review' && state.step === 'submitting') {
          expect(state.attempt!.key).toBe(before.reviewKey);
          episode = { key: state.attempt!.key, body: state.attempt!.body, mintedAtStart: minted };
        }
        // 2. while an outcome is uncertain, nothing mints, replaces or discards the key, and the payload is the frozen one
        if (UNCERTAIN_STEPS.includes(state.step) || state.step === 'retry') {
          expect(episode).not.toBeNull();
          expect(state.attempt!.key).toBe(episode!.key);
          expect(state.attempt!.body).toBe(episode!.body);
          expect(holder.current()).toBe(episode!.key);
          expect(minted).toBe(episode!.mintedAtStart);
        }
        // 3. a state that was uncertain can only be left by a found booking, a bounded wait, or a same-key resend
        if (before.step === 'checking') expect(['checking', 'unsure', 'done']).toContain(state.step);
        if (before.step === 'unsure') expect(['unsure', 'submitting']).toContain(state.step);
        if (UNCERTAIN_STEPS.includes(before.step) && ['FIELD', 'REVIEW', 'BACK', 'START', 'NEW_ATTEMPT'].includes(action.type)) expect(state).toBe(before);
        // 4. every send uses the episode's key and payload
        if (state.sends > lastSends) {
          sendsSeen += 1;
          expect(state.sends).toBe(lastSends + 1);
          expect(state.step).toBe('submitting');
          expect(state.attempt!.key).toBe(episode!.key);
          expect(state.attempt!.body).toBe(episode!.body);
          lastSends = state.sends;
        }
        if (state.step === 'checking') uncertainSeen += 1;
        // 5. the key, if any, always belongs to the content now on screen when a new review begins
        if (state.step === 'review') expect(state.reviewKey).toBe(holder.keyFor(contentOf(state.target!, state.details)));
      }
    }
    expect(sendsSeen).toBeGreaterThan(500);
    expect(uncertainSeen).toBeGreaterThan(500);
  }, 60_000);
});

// ── "Nothing was booked." is a claim, made only when it can be proven ─────────────────────────────────────────────────────────────────
describe('the claim "Nothing was booked." needs proof', () => {
  const CLAIM = /Nothing was booked/i;
  const toUnsure = (h: ReturnType<typeof harness>) => {
    h.toReview();
    h.send({ type: 'SUBMIT' });
    h.send({ type: 'RESPONSE', outcome: { kind: 'uncertain' } });
    for (let i = 0; i < POLL_DELAYS_MS.length; i += 1) h.send({ type: 'POLL', outcome: { kind: 'missing' } });
    expect(h.state.step).toBe('unsure');
  };

  it('a definitive refusal of a first, certain attempt may say nothing was booked', () => {
    const h = harness();
    h.toReview();
    h.send({ type: 'SUBMIT' });
    expect(provableNotBooked(h.state)).toBe(true);
    h.send({ type: 'RESPONSE', outcome: { kind: 'refused', code: 'RESOURCE_CONFLICT', problems: [] } });
    expect(h.state.notice).toMatch(CLAIM);
    expect(h.state.notice).toMatch(/just taken/i);
  });

  it('after an uncertain outcome, EVERY refusal code replaces the claim with the unconfirmed-attempt note', () => {
    for (const code of [...Object.keys(RETURN_TO_TIME), 'VALIDATION', 'SOMETHING_ELSE'] as Array<(typeof DEFINITIVE_CODES)[number]>) {
      const h = harness();
      toUnsure(h);
      h.send({ type: 'RETRY' });
      expect(provableNotBooked(h.state)).toBe(false);
      h.send({ type: 'RESPONSE', outcome: { kind: 'refused', code, problems: [] } });
      const text = h.state.notice ?? '';
      if (h.state.step === 'idle') {
        expect(text, code).not.toMatch(CLAIM);
        expect(text, code).toContain(UNCONFIRMED_NOTE);
      }
    }
  });

  it('a definite resource conflict after an unresolved attempt is distinguished from a clean one', () => {
    const clean = harness();
    clean.toReview();
    clean.send({ type: 'SUBMIT' });
    clean.send({ type: 'RESPONSE', outcome: { kind: 'refused', code: 'RESOURCE_CONFLICT', problems: [] } });
    const unresolved = harness();
    toUnsure(unresolved);
    unresolved.send({ type: 'RETRY' });
    unresolved.send({ type: 'RESPONSE', outcome: { kind: 'refused', code: 'RESOURCE_CONFLICT', problems: [] } });
    expect(clean.state.notice).toMatch(CLAIM);
    expect(unresolved.state.notice).not.toMatch(CLAIM);
    expect(unresolved.state.notice).toMatch(/just taken/i);
    expect(unresolved.state.notice).toContain(UNCONFIRMED_NOTE);
  });

  it('the unconfirmed history sticks to the key: going back to time selection and re-reviewing the same content keeps it unproven', () => {
    const h = harness();
    toUnsure(h);
    h.send({ type: 'RETRY' });
    h.send({ type: 'RESPONSE', outcome: { kind: 'refused', code: 'RESOURCE_CONFLICT', problems: [] } });
    const first = h.state.unconfirmedKeys;
    h.send({ type: 'START', target: TARGET });
    h.send({ type: 'REVIEW' });
    h.send({ type: 'SUBMIT' });
    expect(h.state.attempt!.key).toBe(first[0]); // same content -> the holder returns the same key
    expect(provableNotBooked(h.state)).toBe(false);
    expect(h.minted()).toBe(1);
  });

  it('unconfirmedKeys is not changed by a stray response outside the submitting step', () => {
    const h = harness();
    toUnsure(h);
    const keys = h.state.unconfirmedKeys;
    expect(keys).toHaveLength(1);
    h.send({ type: 'RESPONSE', outcome: { kind: 'created', reservation: reservation(), replayed: false } as never }); // ignored: not submitting
    expect(h.state.unconfirmedKeys).toEqual(keys);
  });

  it('a lookup that finds the booking after an uncertain outcome ends in Booked, with no claim anywhere', () => {
    const h = harness();
    h.toReview();
    h.send({ type: 'SUBMIT' });
    h.send({ type: 'RESPONSE', outcome: { kind: 'uncertain' } });
    h.send({ type: 'POLL', outcome: { kind: 'found', reservation: reservation() } });
    expect(h.state.step).toBe('done');
    expect(h.state.notice).toBeNull();
  });
});
