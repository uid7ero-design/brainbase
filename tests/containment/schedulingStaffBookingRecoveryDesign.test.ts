import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveRecoverySecret } from '@/lib/scheduling/recoverySecret';
import { base64url, hmacSha256, hmacText, sha256 } from '@/lib/scheduling/staffBooking/hmac';
import { BOOKING_KEY_PATTERN, canonicalContent, createBookingKeyHolder, type BookingContent, type BookingKeyHolder } from '@/lib/scheduling/staffBooking/key';
import {
  RESUME_MISMATCH,
  contentOf,
  createMachine,
  initialState,
  provableNotBooked,
  recoveredState,
  recoverySettled,
  settlesAttempt,
  unsafeState,
  type Action,
  type Details,
  type MachineState,
  type Target,
} from '@/lib/scheduling/staffBooking/machine';
import { createPendingStore } from '@/lib/scheduling/staffBooking/pendingStore';
import { DEFINITIVE_CODES, type BookedReservation, type SubmitOutcome } from '@/lib/scheduling/staffBooking/submitClient';

// Phase 2C.3c RELOAD RECOVERY: design-level proofs that need no browser.
//   1. the synchronous HMAC the browser uses is byte-identical to node:crypto;
//   2. the server-derived secret is domain separated and is not a credential;
//   3. the machine's `recovering` step is inert, never mints or discards a key, and the ONLY way to reuse the original key is REVIEW in resume mode with a matching keyed fingerprint;
//   4. the record is removed exactly when the machine says the attempt is resolved (settlesAttempt agrees with the reducer for every outcome);
//   5. source pins: where storage, the secret, `adopt` and time may (not) appear.

describe('hmac.ts is byte-identical to node:crypto', () => {
  it('sha256 and HMAC-SHA-256 agree on empty, boundary-length, long and random inputs, with short, 64-byte and long keys', () => {
    const lengths = [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000];
    for (const n of lengths) {
      const data = randomBytes(n);
      expect(Buffer.from(sha256(data)).toString('hex'), `sha256 length ${n}`).toBe(createHash('sha256').update(data).digest('hex'));
      for (const keyLength of [0, 1, 32, 64, 65, 200]) {
        const key = randomBytes(keyLength);
        expect(Buffer.from(hmacSha256(key, data)).toString('hex'), `hmac data ${n} key ${keyLength}`).toBe(createHmac('sha256', key).update(data).digest('hex'));
      }
    }
  });

  it('matches the published SHA-256 and RFC 4231 test vectors', () => {
    expect(Buffer.from(sha256(new TextEncoder().encode('abc'))).toString('hex')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const key = Buffer.alloc(20, 0x0b);
    expect(Buffer.from(hmacSha256(key, new TextEncoder().encode('Hi There'))).toString('hex')).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
  });

  it('base64url and hmacText match node, including non-ASCII text', () => {
    for (const text of ['', 'a', 'ab', 'abc', 'Pat Customer · 0400 000 000', 'ü€𝄞']) {
      expect(hmacText('secret-key', text)).toBe(createHmac('sha256', 'secret-key').update(text, 'utf8').digest('base64url'));
      expect(base64url(new TextEncoder().encode(text))).toBe(Buffer.from(text, 'utf8').toString('base64url'));
    }
  });
});

describe('the recovery secret is domain separated and is not a credential', () => {
  const SESSION = 'a-session-signing-secret-that-must-never-leak';
  const secret = deriveRecoverySecret(SESSION, 'user-1', 'org-1');

  it('is not the session secret, not derivable by hashing the ids, and differs from the same HMAC without the label', () => {
    expect(secret).not.toContain(SESSION);
    expect(secret).not.toBe(createHmac('sha256', SESSION).update('user-1org-1').digest('base64url'));
    expect(secret).not.toBe(createHmac('sha256', SESSION).update('user-1|org-1').digest('base64url'));
    expect(secret).not.toBe(createHash('sha256').update(`${SESSION}user-1org-1`).digest('base64url'));
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('is stable for one user and organisation (sign-out then sign-in finds the same record) and differs for any other pair', () => {
    expect(deriveRecoverySecret(SESSION, 'user-1', 'org-1')).toBe(secret);
    const others = [['user-2', 'org-1'], ['user-1', 'org-2'], ['org-1', 'user-1'], ['user-1o', 'rg-1'], ['', 'user-1org-1']];
    for (const [u, o] of others) expect(deriveRecoverySecret(SESSION, u, o)).not.toBe(secret);
  });

  it('what the browser derives from it (scope, fingerprint) cannot be turned back into it or used as a token', () => {
    const store = createPendingStore(secret, { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, key: () => null, clear: () => undefined, length: 0 } as Storage);
    expect(store.scope).not.toContain(secret.slice(0, 8));
    expect(store.fingerprint('x')).not.toContain(secret.slice(0, 8));
    expect(store.scope).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

// ── the machine ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

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
const DETAILS: Details = { name: 'Pat Customer', email: 'pat@example.test', phone: '0400 000 000', partySize: '2', notes: 'Bring a ball hopper' };
const ORIGINAL = `bk_${'a'.repeat(32)}`;
const memory = (): Storage => {
  const m = new Map<string, string>();
  return { get length() { return m.size; }, clear: () => m.clear(), getItem: k => m.get(k) ?? null, key: i => [...m.keys()][i] ?? null, removeItem: k => void m.delete(k), setItem: (k, v) => void m.set(k, v) };
};
const store = createPendingStore('rs_property_secret_0123456789012345678901', memory());
const PENDING = { key: ORIGINAL, fp: store.fingerprint(canonicalContent(contentOf(TARGET, DETAILS))) };
const reservation: BookedReservation = {
  id: 'res-0123456789abcdef0123456789abcdef', status: 'confirmed', offeringId: 'off-1', resourceId: 'court-1', timezone: 'Australia/Adelaide',
  start: { date: '2027-01-11', time: '10:00' }, durationMinutes: 60, startsAt: TARGET.startsAt, endsAt: '2027-01-11T00:30:00.000Z', partySize: 2,
  customer: { name: 'Pat Customer', email: 'pat@example.test', phone: '0400 000 000' }, notes: 'Bring a ball hopper', price: { amountCents: 5000, currency: 'AUD' }, paymentStatus: 'unpaid',
};

interface Counts { keyFor: number; adopt: Array<{ key: string; content: BookingContent }>; discard: number }
function counting(): { holder: BookingKeyHolder; counts: Counts } {
  const inner = createBookingKeyHolder();
  const counts: Counts = { keyFor: 0, adopt: [], discard: 0 };
  return {
    counts,
    holder: {
      keyFor: c => { counts.keyFor += 1; return inner.keyFor(c); },
      adopt: (key, content) => { counts.adopt.push({ key, content }); inner.adopt(key, content); },
      current: () => inner.current(),
      discard: () => { counts.discard += 1; inner.discard(); },
    },
  };
}
const machine = () => {
  const { holder, counts } = counting();
  return { reduce: createMachine(holder, { fingerprint: c => store.fingerprint(c) }), counts };
};
const run = (reduce: ReturnType<typeof machine>['reduce'], from: MachineState, ...actions: Action[]) => actions.reduce(reduce, from);
function fillDetails(reduce: ReturnType<typeof machine>['reduce'], from: MachineState, d: Details = DETAILS): MachineState {
  return (Object.keys(d) as Array<keyof Details>).reduce((s, field) => reduce(s, { type: 'FIELD', field, value: d[field] }), from);
}
/** recovering -> (one lookup, nothing found) -> settled -> Enter the booking again -> idle (resume) */
const settled = (reduce: ReturnType<typeof machine>['reduce'], from: MachineState = recoveredState(PENDING)) => reduce(from, { type: 'POLL', outcome: { kind: 'missing' } });
const resumed = (reduce: ReturnType<typeof machine>['reduce']) => reduce(settled(reduce), { type: 'ENTER_AGAIN' });

const OUTCOMES: SubmitOutcome[] = [
  { kind: 'created', reservation, replayed: true, recovered: false },
  { kind: 'uncertain' },
  { kind: 'gate_off' },
  { kind: 'denied' },
  ...DEFINITIVE_CODES.map(code => ({ kind: 'refused', code, problems: [] }) as SubmitOutcome),
];

describe('the recovering step is inert and never touches the key', () => {
  it('every action that could change the booking, the key or the step returns the SAME state object, and the holder is never asked for anything', () => {
    const { reduce, counts } = machine();
    const start = recoveredState(PENDING);
    const actions: Action[] = [
      { type: 'START', target: TARGET }, { type: 'FIELD', field: 'name', value: 'x' }, { type: 'REVIEW' }, { type: 'BACK' }, { type: 'SUBMIT' }, { type: 'RETRY' },
      { type: 'NEW_ATTEMPT' }, { type: 'STORE_FAILED' }, { type: 'RETRY_FROZEN' }, { type: 'ENTER_AGAIN' }, { type: 'CHECK_AGAIN' }, { type: 'CONFLICT_LOOKUP', outcome: { kind: 'missing' } },
      ...OUTCOMES.map(outcome => ({ type: 'RESPONSE', outcome }) as Action),
    ];
    for (const a of actions) expect(reduce(start, a), JSON.stringify(a).slice(0, 80)).toBe(start);
    expect(counts).toEqual({ keyFor: 0, adopt: [], discard: 0 });
  });

  it('no number of "not found" or failed lookups, and no passage of time, ever resolves it: it stays recovering and the key stays unconfirmed', () => {
    const { reduce, counts } = machine();
    let s = recoveredState(PENDING);
    for (let i = 0; i < 1000; i += 1) s = reduce(s, { type: 'POLL', outcome: i % 2 ? { kind: 'missing' } : { kind: 'error' } });
    expect(s.step).toBe('recovering');
    expect(s.pending).toEqual(PENDING);
    expect(recoverySettled(s)).toBe(true);
    expect(s.unconfirmedKeys).toContain(ORIGINAL);
    expect(counts).toEqual({ keyFor: 0, adopt: [], discard: 0 });
    // CHECK_AGAIN only asks again; it does not resolve
    expect(reduce(s, { type: 'CHECK_AGAIN' })).toMatchObject({ step: 'recovering', poll: 0 });
  });

  it('a found booking is the only lookup result that resolves it (Booked, record resolved)', () => {
    const { reduce } = machine();
    const s = reduce(recoveredState(PENDING), { type: 'POLL', outcome: { kind: 'found', reservation } });
    expect(s).toMatchObject({ step: 'done', pending: null, resume: null });
    expect(s.reservation).toEqual(reservation);
  });

  it('a withheld (unsafe) dialog is inert too, for every action', () => {
    const { reduce, counts } = machine();
    for (const reason of ['cannot_store', 'corrupt_record', 'no_secret'] as const) {
      const start = unsafeState(reason);
      for (const a of [{ type: 'START', target: TARGET }, { type: 'REVIEW' }, { type: 'SUBMIT' }, { type: 'RETRY' }, { type: 'NEW_ATTEMPT' }, { type: 'ENTER_AGAIN' }, { type: 'STORE_FAILED' }] as Action[]) expect(reduce(start, a)).toBe(start);
    }
    expect(counts).toEqual({ keyFor: 0, adopt: [], discard: 0 });
  });

  it('the recovered key is already unconfirmed, so no wording after it claims "Nothing was booked."', () => {
    expect(provableNotBooked({ attempt: { key: ORIGINAL, body: {} as never, content: {} as never }, unconfirmedKeys: recoveredState(PENDING).unconfirmedKeys })).toBe(false);
  });
});

describe('resume mode: the original key, for the same content only', () => {
  it('different content is refused at REVIEW: no step change, no adopt, no keyFor, no new key', () => {
    const { reduce, counts } = machine();
    for (const change of [{ name: 'Someone Else' }, { email: 'other@example.test' }, { phone: '0411 111 111' }, { partySize: '3' }, { notes: 'x' }] as Array<Partial<Details>>) {
      const s = run(reduce, resumed(reduce), { type: 'START', target: TARGET });
      const filled = fillDetails(reduce, s, { ...DETAILS, ...change });
      const next = reduce(filled, { type: 'REVIEW' });
      expect(next.step).toBe('details');
      expect(next.notice).toBe(RESUME_MISMATCH);
      expect(next.reviewKey).toBeNull();
    }
    // a different time or resource is a different content as well
    for (const target of [{ ...TARGET, time: '11:00' }, { ...TARGET, date: '2027-01-12' }, { ...TARGET, resourceId: 'court-2' }]) {
      const s = fillDetails(reduce, run(reduce, resumed(reduce), { type: 'START', target }));
      expect(reduce(s, { type: 'REVIEW' }).notice).toBe(RESUME_MISMATCH);
    }
    expect(counts).toEqual({ keyFor: 0, adopt: [], discard: 0 });
  });

  it('the same content (surrounding spaces ignored, as for any booking) adopts the ORIGINAL key exactly once and mints nothing; SUBMIT freezes it', () => {
    const { reduce, counts } = machine();
    const s = fillDetails(reduce, run(reduce, resumed(reduce), { type: 'START', target: TARGET }), { ...DETAILS, name: '  Pat Customer ' });
    const review = reduce(s, { type: 'REVIEW' });
    expect(review).toMatchObject({ step: 'review', reviewKey: ORIGINAL });
    expect(counts.keyFor).toBe(0);
    expect(counts.adopt).toHaveLength(1);
    expect(counts.adopt[0].key).toBe(ORIGINAL);
    const sent = reduce(review, { type: 'SUBMIT' });
    expect(sent.attempt?.key).toBe(ORIGINAL);
    expect(sent.sends).toBe(1);
  });

  it('without a fingerprint function resume mode can never proceed (fail closed)', () => {
    const { holder, counts } = counting();
    const reduce = createMachine(holder);
    const s = fillDetails(reduce, run(reduce, resumed(machine().reduce), { type: 'START', target: TARGET }));
    expect(reduce(s, { type: 'REVIEW' }).step).toBe('details');
    expect(counts).toEqual({ keyFor: 0, adopt: [], discard: 0 });
  });

  it('PROPERTY: over random action sequences from resume mode, a key is only ever the original one; keyFor and discard are never called; adopt only ever receives the original', () => {
    let seed = 20271101;
    const rand = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
    const fields: Array<keyof Details> = ['name', 'email', 'phone', 'partySize', 'notes'];
    const values = ['Pat Customer', 'Other', 'pat@example.test', '', '0400 000 000', '2', '3', 'Bring a ball hopper', 'x'];
    const targets = [TARGET, { ...TARGET, time: '11:00' }, { ...TARGET, resourceId: 'court-2' }];
    for (let run_ = 0; run_ < 300; run_ += 1) {
      const { reduce, counts } = machine();
      let s = resumed(reduce);
      for (let step = 0; step < 40; step += 1) {
        const roll = rand(10);
        const a: Action =
          roll < 3 ? { type: 'FIELD', field: fields[rand(fields.length)], value: values[rand(values.length)] }
          : roll < 5 ? { type: 'START', target: targets[rand(targets.length)] }
          : roll < 7 ? { type: 'REVIEW' }
          : roll < 8 ? { type: 'BACK' }
          : roll < 9 ? { type: 'SUBMIT' }
          : { type: 'RESPONSE', outcome: OUTCOMES[rand(OUTCOMES.length)] };
        s = reduce(s, a);
        if (s.reviewKey) expect(s.reviewKey).toBe(ORIGINAL);
        if (s.attempt) expect(s.attempt.key).toBe(ORIGINAL);
        if (s.step === 'review' || s.step === 'submitting') expect(s.attempt === null || s.attempt.key === ORIGINAL).toBe(true);
        expect(counts.keyFor).toBe(0);
        expect(counts.discard).toBe(0);
        for (const ad of counts.adopt) expect(ad.key).toBe(ORIGINAL);
        if (s.step === 'done' || s.pending === null) break; // resolved: resume mode is over by construction
      }
    }
  });
});

describe('the record is removed exactly when the machine resolves the attempt', () => {
  function submittingWith(flag: 'uncertainBefore' | 'clean'): MachineState {
    const { reduce } = machine();
    let s = fillDetails(reduce, run(reduce, resumed(reduce), { type: 'START', target: TARGET }));
    s = run(reduce, s, { type: 'REVIEW' }, { type: 'SUBMIT' });
    expect(s.step).toBe('submitting');
    return flag === 'clean' ? { ...s, unconfirmedKeys: [] } : s;
  }
  it('settlesAttempt agrees with the reducer: pending is cleared iff the outcome settles the attempt, for every outcome and both histories', () => {
    for (const history of ['uncertainBefore', 'clean'] as const) {
      for (const outcome of OUTCOMES) {
        const { reduce } = machine();
        const next = reduce(submittingWith(history), { type: 'RESPONSE', outcome });
        const label = `${history} / ${outcome.kind}${'code' in outcome ? ` ${outcome.code}` : ''}`;
        expect(next.pending === null, label).toBe(settlesAttempt(outcome, history === 'uncertainBefore'));
        expect(next.resume === null, label).toBe(settlesAttempt(outcome, history === 'uncertainBefore'));
      }
    }
  });

  it('an uncertain outcome, a timeout, CONTENTION_TIMEOUT and (after an uncertain send) a 401/403/404 never resolve it', () => {
    expect(settlesAttempt({ kind: 'uncertain' }, false)).toBe(false);
    expect(settlesAttempt({ kind: 'refused', code: 'CONTENTION_TIMEOUT', problems: [] }, false)).toBe(false);
    expect(settlesAttempt({ kind: 'denied' }, true)).toBe(false);
    expect(settlesAttempt({ kind: 'gate_off' }, true)).toBe(false);
    expect(settlesAttempt({ kind: 'denied' }, false)).toBe(true);
  });
});

// ── source pins ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '..', '..');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const read = (rel: string) => strip(readFileSync(path.join(ROOT, rel), 'utf8'));
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}
const APP_AND_LIB = [...walk('app'), ...walk('lib')];
const BOOKING_UI = [...walk('lib/scheduling/staffBooking'), 'app/scheduling/_components/StaffBookDialog.tsx', 'app/scheduling/_components/CalendarScreen.tsx'];

describe('source pins', () => {
  it('adopt() is called from machine.ts only, and the key holder is never given a key from anywhere else', () => {
    const callers = APP_AND_LIB.filter(f => /\.adopt\(/.test(read(f)));
    expect(callers).toEqual(['lib/scheduling/staffBooking/machine.ts']);
    expect(read('lib/scheduling/staffBooking/machine.ts').match(/\.adopt\(/g)).toHaveLength(1);
  });

  it('browser storage is touched in ONE module (recoveryBoot.ts); pendingStore receives the Storage it is given and nothing else reads or writes storage, cookies or IndexedDB', () => {
    const users = BOOKING_UI.filter(f => /sessionStorage|localStorage|indexedDB|document\.cookie|caches\./.test(read(f)));
    expect(users).toEqual(['lib/scheduling/staffBooking/recoveryBoot.ts']);
    expect(read('lib/scheduling/staffBooking/recoveryBoot.ts')).not.toMatch(/localStorage|indexedDB|document\.cookie/);
  });

  it('the server-only secret derivation is imported by the server visibility module only, and never by a client module', () => {
    const importers = APP_AND_LIB.filter(f => read(f).includes("deriveRecoverySecret") && f !== "lib/scheduling/recoverySecret.ts");
    expect(importers).toEqual(['lib/scheduling/staffBookingVisibility.ts']);
    for (const f of BOOKING_UI.filter(x => !x.endsWith('/recoverySecret.ts'))) expect(read(f), f).not.toMatch(/node:crypto|from 'crypto'|SESSION_SECRET/);
    expect(read('lib/scheduling/recoverySecret.ts')).toMatch(/^import 'server-only';/m);
    expect(read('lib/scheduling/staffBookingVisibility.ts')).toMatch(/^import 'server-only';/m);
  });

  it('the secret authorises nothing: no API route, middleware or request helper reads it, and no request carries it', () => {
    const apiAndMiddleware = [...walk('app/api'), ...APP_AND_LIB.filter(f => /(^|\/)middleware\.ts$|proxy\.ts$/.test(f))];
    for (const f of apiAndMiddleware) expect(read(f), f).not.toMatch(/recoverySecret|sched-recovery|bb\.sched\.pending/);
    for (const f of ['lib/scheduling/staffBooking/submitClient.ts', 'lib/scheduling/staffBooking/basisClient.ts']) expect(read(f), f).not.toMatch(/recoverySecret|hmac|pendingStore|sessionStorage/i);
  });

  it('nothing in recovery reads a clock to decide: no expiry, quiet period, age check or sweep (savedAt is written, never compared)', () => {
    for (const f of ['lib/scheduling/staffBooking/machine.ts', 'lib/scheduling/staffBooking/attemptStore.ts', 'lib/scheduling/staffBooking/recoveryBoot.ts']) expect(read(f), f).not.toMatch(/Date\.now|new Date|performance\.now|setTimeout|setInterval/);
    const pending = read('lib/scheduling/staffBooking/pendingStore.ts');
    expect(pending.match(/Date\.now\(\)/g)).toHaveLength(1); // the single write of savedAt
    expect(pending.match(/savedAt/g)?.length).toBeLessThanOrEqual(5);
    expect(pending).not.toMatch(/savedAt\s*[<>]|[<>]=?\s*[\w.]*savedAt|Date\.now\(\)\s*-/);
    const dialog = read('app/scheduling/_components/StaffBookDialog.tsx');
    expect(dialog).not.toMatch(/savedAt/);
    expect(dialog).not.toMatch(/expire|expiry|stale record|older than/i);
  });

  it('the write-ahead record is removed in exactly two places in the dialog: after a booking exists, and on a settling answer', () => {
    const dialog = read('app/scheduling/_components/StaffBookDialog.tsx');
    expect(dialog.match(/store\??\.clear\(\)/g)).toHaveLength(2);
    expect(dialog).toMatch(/if \(settlesAttempt\(outcome, uncertainBefore\)\) store\.clear\(\)/);
    expect(dialog).toMatch(/if \(m\.step === 'done'\) store\?\.clear\(\)/);
    // the record is written (ensure) BEFORE the request is sent, in the same effect
    expect(dialog.indexOf('store.ensure(')).toBeGreaterThan(0);
    expect(dialog.indexOf('store.ensure(')).toBeLessThan(dialog.indexOf('postReservation(body, key)'));
  });

  it('recoverySecret and the record are never put in a URL, a header, the DOM or a log by the booking UI', () => {
    for (const f of BOOKING_UI) {
      const src = read(f);
      expect(src, f).not.toMatch(/console\.(log|info|warn|error)\([^)]*(recoverySecret|pending|fingerprint)/i);
      expect(src, f).not.toMatch(/(href|src|action)=\{[^}]*recoverySecret/);
      expect(src, f).not.toMatch(/data-[a-z-]+=\{[^}]*(recoverySecret|pending\.)/);
    }
    expect(BOOKING_KEY_PATTERN.test(ORIGINAL)).toBe(true);
  });

  it('a fresh machine and a fresh dialog hold no pending attempt', () => {
    expect(initialState()).toMatchObject({ pending: null, resume: null, unsafeReason: null, unconfirmedKeys: [] });
  });
});
