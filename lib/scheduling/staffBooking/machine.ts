import type { BookingContent, BookingKeyHolder } from './key';
import type { BookedReservation, CreateBody, DefinitiveCode, SubmitOutcome, LookupOutcome } from './submitClient';

// Phase 2C.3c UI slice 2: the booking state machine, from "customer details" to "booked". PURE (no I/O, no clock, no React): the dialog
// performs the effects (the POST, the reconcile lookups, the timers) and feeds the results back as actions.
//
// THE SAFETY RULE this file exists to prove:
//   - the idempotency key is asked of the holder in exactly ONE place (REVIEW), once per distinct booking content;
//   - SUBMIT freezes {key, body} into `attempt`; every retry (CONTENTION_TIMEOUT, an unsure outcome) re-sends that frozen attempt verbatim;
//   - while an outcome is uncertain (submitting, checking, unsure) every action that could change the booking content, the key or the step
//     (FIELD, REVIEW, BACK, START, NEW_ATTEMPT) is ignored, so no sequence of uncertain outcomes can mint, change or discard a key;
//   - the only transition that discards the key is NEW_ATTEMPT, reachable only from `conflict` (IDEMPOTENCY_CONFLICT), on the staff member's choice.
// Customer details live in this state only. Nothing here reads or writes any storage.

export const NAME_MAX = 120;
export const EMAIL_MAX = 254;
export const PHONE_MAX = 32;
export const NOTES_MAX = 1000;
export const PARTY_MAX = 1000;
/** Reconcile lookups after an uncertain outcome: wait this long, look, repeat. Bounded; then only a same-key retry is offered. */
export const POLL_DELAYS_MS = [500, 1500, 3000, 6000] as const;

export type FieldKey = 'name' | 'email' | 'phone' | 'partySize' | 'notes';
export interface Details {
  name: string;
  email: string;
  phone: string;
  partySize: string;
  notes: string;
}
export type FieldErrors = Partial<Record<FieldKey, string>>;

/** Everything chosen before the customer step: engine-offered, never typed. `basis` is the stamp set the start was offered under. */
export interface Target {
  offeringId: string;
  offeringName: string;
  resourceId: string;
  resourceName: string;
  date: string;
  time: string;
  startsAt: string;
  durationMinutes: number;
  timezone: string;
  capacity: number;
  price: { amountCents: number; currency: string } | null;
  basis: CreateBody['basis'];
}

export type Step = 'idle' | 'details' | 'review' | 'submitting' | 'checking' | 'unsure' | 'retry' | 'conflict' | 'done' | 'unavailable' | 'denied';
/** Outcome unknown: the booking may exist. Nothing may change the content or the key, and nothing may start a second attempt except a same-key retry. */
export const UNCERTAIN_STEPS: readonly Step[] = ['submitting', 'checking', 'unsure'];

export interface Attempt {
  key: string;
  body: CreateBody;
  content: BookingContent;
}

export interface MachineState {
  step: Step;
  target: Target | null;
  details: Details;
  errors: FieldErrors;
  /** Bumped whenever the error summary should take focus. */
  errorTick: number;
  /** A polite banner shown on the step the user is returned to. */
  notice: string | null;
  /** After AVAILABILITY_CHANGED: preselect this start again, only if it is still offered. */
  preferTime: { date: string; time: string } | null;
  reviewKey: string | null;
  attempt: Attempt | null;
  /** How many POSTs have been started (the dialog sends one per increment). */
  sends: number;
  /** Which reconcile wait/lookup is next (an index into POLL_DELAYS_MS). */
  poll: number;
  reservation: BookedReservation | null;
  /** The booking found does not match what was submitted. */
  mismatch: boolean;
  /** Bumped whenever the dialog must re-read the basis. */
  refetch: number;
  /** IDEMPOTENCY_CONFLICT: what already exists under the key, once looked up. */
  conflictFound: BookedReservation | null;
}

export const initialDetails: Details = { name: '', email: '', phone: '', partySize: '1', notes: '' };

export function initialState(): MachineState {
  return { step: 'idle', target: null, details: initialDetails, errors: {}, errorTick: 0, notice: null, preferTime: null, reviewKey: null, attempt: null, sends: 0, poll: 0, reservation: null, mismatch: false, refetch: 0, conflictFound: null };
}

export type Action =
  | { type: 'START'; target: Target }
  | { type: 'FIELD'; field: FieldKey; value: string }
  | { type: 'REVIEW' }
  | { type: 'BACK' }
  | { type: 'SUBMIT' }
  | { type: 'RESPONSE'; outcome: SubmitOutcome }
  | { type: 'POLL'; outcome: LookupOutcome }
  | { type: 'RETRY' }
  | { type: 'CONFLICT_LOOKUP'; outcome: LookupOutcome }
  | { type: 'NEW_ATTEMPT' };

// ── validation (a convenience for the staff member: the API is the authority and re-checks everything) ──────────────────────────────

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_SHAPE = /^[0-9+()\-.\s]{3,32}$/;

export function validateDetails(d: Details, capacity: number): FieldErrors {
  const e: FieldErrors = {};
  const name = d.name.trim();
  if (name === '') e.name = 'Enter the customer’s name.';
  else if (name.length > NAME_MAX) e.name = `Use ${NAME_MAX} characters or fewer.`;
  else if (CONTROL.test(name)) e.name = 'Remove the special characters.';

  const email = d.email.trim();
  if (email !== '' && (email.length > EMAIL_MAX || !EMAIL_SHAPE.test(email) || CONTROL.test(email))) e.email = 'Enter an email address like name@example.com, or leave it empty.';

  const phone = d.phone.trim();
  if (phone !== '' && (!PHONE_SHAPE.test(phone) || !/[0-9]/.test(phone))) e.phone = 'Use digits, spaces and + ( ) - . only (3 to 32 characters), or leave it empty.';

  const party = d.partySize.trim();
  const limit = Math.min(capacity, PARTY_MAX);
  if (!/^[0-9]{1,4}$/.test(party) || Number(party) < 1) e.partySize = `Enter a whole number from 1 to ${limit}.`;
  else if (Number(party) > limit) e.partySize = `This resource holds ${limit}. Enter ${limit} or fewer.`;

  if (d.notes.length > NOTES_MAX) e.notes = `Use ${NOTES_MAX} characters or fewer.`;
  else if (CONTROL.test(d.notes)) e.notes = 'Remove the special characters.';
  return e;
}

const trimmed = (d: Details) => ({ name: d.name.trim(), email: d.email.trim(), phone: d.phone.trim(), notes: d.notes.trim(), party: Number(d.partySize.trim()) });

export function contentOf(t: Target, d: Details): BookingContent {
  const x = trimmed(d);
  return {
    offeringId: t.offeringId,
    resourceId: t.resourceId,
    date: t.date,
    time: t.time,
    partySize: x.party,
    customerName: x.name,
    ...(x.email ? { email: x.email } : {}),
    ...(x.phone ? { phone: x.phone } : {}),
    ...(x.notes ? { notes: x.notes } : {}),
  };
}

export function bodyOf(t: Target, d: Details): CreateBody {
  const x = trimmed(d);
  return {
    offeringId: t.offeringId,
    resourceId: t.resourceId,
    start: { date: t.date, time: t.time },
    durationMinutes: t.durationMinutes,
    partySize: x.party,
    customer: { name: x.name, ...(x.email ? { email: x.email } : {}), ...(x.phone ? { phone: x.phone } : {}) },
    ...(x.notes ? { notes: x.notes } : {}),
    basis: t.basis,
  };
}

// ── error vocabulary (fixed wording per code; never server text) ──────────────────────────────────────────────────────────────────────

/** Refusals that mean "the time you picked is not (or no longer) bookable": the basis is re-read and the staff member picks again. */
export const RETURN_TO_TIME: Readonly<Partial<Record<DefinitiveCode, string>>> = {
  AVAILABILITY_CHANGED: 'The available times changed. Nothing was booked. Check the time and choose again.',
  RESOURCE_CONFLICT: 'That time was just taken. Nothing was booked. The times below are up to date.',
  OFF_GRID: 'That time is no longer offered. Nothing was booked.',
  OUTSIDE_AVAILABILITY: 'That time is no longer offered. Nothing was booked.',
  IN_THE_PAST: 'That time has already started. Nothing was booked.',
  RESOURCE_INACTIVE: 'This resource is no longer active. Nothing was booked.',
  OFFERING_UNAVAILABLE: 'This offering is no longer available. Nothing was booked.',
  RESOURCE_NOT_ELIGIBLE: 'This resource is no longer offered for this booking. Nothing was booked.',
  NONEXISTENT_LOCAL_TIME: 'This can’t be booked. Pick another time. Nothing was booked.',
  DURATION_NOT_ALLOWED: 'This can’t be booked. Pick another time. Nothing was booked.',
  OFFERING_NOT_BOOKABLE: 'This can’t be booked. Pick another time. Nothing was booked.',
  NOT_FOUND: 'This resource or offering no longer exists, or you no longer have access to it. Nothing was booked.',
};

const PROBLEM_FIELD: Readonly<Record<string, FieldKey>> = {
  'customer.name': 'name',
  'customer.email': 'email',
  'customer.phone': 'phone',
  partySize: 'partySize',
  notes: 'notes',
};
const FIELD_MESSAGE: Readonly<Record<FieldKey, string>> = {
  name: 'The name was not accepted. Check it.',
  email: 'The email address was not accepted. Check it, or leave it empty.',
  phone: 'The phone number was not accepted. Check it, or leave it empty.',
  partySize: 'The party size was not accepted. Check it.',
  notes: 'The notes were not accepted. Check them.',
};

function matches(a: BookingContent, r: BookedReservation): boolean {
  return r.resourceId === a.resourceId && r.offeringId === a.offeringId && r.start?.date === a.date && r.start?.time === a.time && r.partySize === a.partySize;
}

const done = (state: MachineState, reservation: BookedReservation): MachineState => ({
  ...state,
  step: 'done',
  reservation,
  mismatch: state.attempt ? !matches(state.attempt.content, reservation) : false,
  notice: null,
  errors: {},
  conflictFound: null,
});

// ── the reducer ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Reduce = (state: MachineState, action: Action) => MachineState;

/**
 * `holder` is the one idempotency-key holder (lib/scheduling/staffBooking/key.ts). It is touched in REVIEW (keyFor) and NEW_ATTEMPT
 * (discard) and nowhere else. keyFor is idempotent for unchanged content, so a re-run of the reducer (React strict mode) is harmless.
 */
export function createMachine(holder: BookingKeyHolder): Reduce {
  return function reduce(state, action) {
    switch (action.type) {
      case 'START': {
        if (state.step !== 'idle') return state;
        return { ...state, step: 'details', target: action.target, errors: {}, notice: null, reservation: null, attempt: null, reviewKey: null };
      }

      case 'FIELD': {
        if (state.step !== 'details') return state;
        const { [action.field]: _cleared, ...errors } = state.errors;
        void _cleared;
        return { ...state, details: { ...state.details, [action.field]: action.value }, errors };
      }

      case 'REVIEW': {
        if (state.step !== 'details' || !state.target) return state;
        const errors = validateDetails(state.details, state.target.capacity);
        if (Object.keys(errors).length > 0) return { ...state, errors, errorTick: state.errorTick + 1, notice: null };
        const reviewKey = holder.keyFor(contentOf(state.target, state.details)); // the ONLY place a key is asked for
        return { ...state, step: 'review', errors: {}, reviewKey, notice: null };
      }

      case 'BACK': {
        if (state.step === 'review') return { ...state, step: 'details', notice: null };
        if (state.step === 'details') return { ...state, step: 'idle', notice: null, errors: {} };
        return state; // never from an uncertain, final or busy step
      }

      case 'SUBMIT': {
        if (state.step !== 'review' || !state.target || !state.reviewKey) return state; // a second activation while busy lands here and does nothing
        const attempt: Attempt = { key: state.reviewKey, body: bodyOf(state.target, state.details), content: contentOf(state.target, state.details) };
        return { ...state, step: 'submitting', attempt, sends: state.sends + 1, poll: 0, notice: null };
      }

      case 'RETRY': {
        if ((state.step !== 'retry' && state.step !== 'unsure') || !state.attempt) return state;
        return { ...state, step: 'submitting', sends: state.sends + 1, poll: 0 }; // the frozen attempt: the same key and the same body
      }

      case 'RESPONSE': {
        if (state.step !== 'submitting' || !state.attempt || !state.target) return state;
        const o = action.outcome;
        if (o.kind === 'created') return done(state, o.reservation);
        if (o.kind === 'uncertain') return { ...state, step: 'checking', poll: 0 };
        if (o.kind === 'gate_off') return { ...state, step: 'unavailable' };
        if (o.kind === 'denied') return { ...state, step: 'denied' };
        const code = o.code;
        if (code === 'CONTENTION_TIMEOUT') return { ...state, step: 'retry' };
        if (code === 'BOOKING_NOT_READY') return { ...state, step: 'unavailable' };
        if (code === 'IDEMPOTENCY_CONFLICT') return { ...state, step: 'conflict', conflictFound: null };
        if (code === 'PARTY_NOT_ALLOWED') return { ...state, step: 'details', attempt: null, errors: { partySize: `This resource holds ${state.target.capacity}. Enter ${state.target.capacity} or fewer.` }, errorTick: state.errorTick + 1 };
        if (code === 'VALIDATION') {
          const errors: FieldErrors = {};
          for (const p of o.problems) {
            const f = PROBLEM_FIELD[p];
            if (f) errors[f] = FIELD_MESSAGE[f];
          }
          const notice = Object.keys(errors).length === 0 ? 'The booking was not accepted. Check the details. Nothing was booked.' : null;
          return { ...state, step: 'details', attempt: null, errors, errorTick: state.errorTick + 1, notice };
        }
        const text = RETURN_TO_TIME[code] ?? 'That time can’t be booked. Nothing was booked.';
        return {
          ...state,
          step: 'idle',
          attempt: null,
          notice: text,
          preferTime: code === 'AVAILABILITY_CHANGED' ? { date: state.target.date, time: state.target.time } : null,
          refetch: state.refetch + 1,
          errors: {},
        };
      }

      case 'POLL': {
        if (state.step !== 'checking') return state;
        if (action.outcome.kind === 'found') return done(state, action.outcome.reservation);
        // missing OR a failed lookup: still not provable (an in-flight write may land late). Keep checking, then offer only a same-key retry.
        const next = state.poll + 1;
        return next < POLL_DELAYS_MS.length ? { ...state, poll: next } : { ...state, step: 'unsure', poll: next };
      }

      case 'CONFLICT_LOOKUP': {
        if (state.step !== 'conflict') return state;
        return { ...state, conflictFound: action.outcome.kind === 'found' ? action.outcome.reservation : null };
      }

      case 'NEW_ATTEMPT': {
        if (state.step !== 'conflict') return state;
        holder.discard(); // the only discard: the key already holds a DIFFERENT booking, and the staff member chose to start again
        return { ...state, step: 'idle', attempt: null, reviewKey: null, conflictFound: null, notice: null, refetch: state.refetch + 1, preferTime: null };
      }
    }
  };
}
