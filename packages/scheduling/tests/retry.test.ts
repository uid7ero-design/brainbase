import { describe, expect, it } from 'vitest';
import { BACKGROUND_RETRY, INTERACTIVE_RETRY, SchedulingError, backoffDelayMs, retryOnContention } from '../src';

const env = () => {
  const sleeps: number[] = [];
  return { sleeps, sleep: async (ms: number) => void sleeps.push(ms), random: () => 0.5 };
};
const timeout = () => new SchedulingError('contention_timeout', 'canceling statement due to lock timeout');

describe('retryOnContention', () => {
  it('returns the first result without sleeping when nothing fails', async () => {
    const e = env();
    await expect(retryOnContention(async () => 'ok', INTERACTIVE_RETRY, e)).resolves.toBe('ok');
    expect(e.sleeps).toEqual([]);
  });

  it('retries a contention_timeout, with backoff, until it succeeds', async () => {
    const e = env();
    let calls = 0;
    const result = await retryOnContention(async () => {
      if (++calls < 3) throw timeout();
      return calls;
    }, BACKGROUND_RETRY, e);
    expect(result).toBe(3);
    expect(e.sleeps).toEqual([Math.floor(0.5 * 500), Math.floor(0.5 * 1000)]); // jittered, doubling
  });

  it('an interactive caller makes exactly two attempts, then surfaces the timeout (never loops)', async () => {
    const e = env();
    let calls = 0;
    await expect(retryOnContention(async () => { calls++; throw timeout(); }, INTERACTIVE_RETRY, e)).rejects.toMatchObject({ code: 'contention_timeout' });
    expect(calls).toBe(2);
    expect(e.sleeps).toHaveLength(1);
  });

  it('a hostile policy cannot make it unbounded: attempts are capped at 5', async () => {
    const e = env();
    let calls = 0;
    await expect(retryOnContention(async () => { calls++; throw timeout(); }, { maxAttempts: 1_000_000, baseDelayMs: 1, maxDelayMs: 1 }, e)).rejects.toBeInstanceOf(SchedulingError);
    expect(calls).toBe(5);
  });

  it('never retries a real answer: full, unavailable, duplicate, lifecycle', async () => {
    for (const code of ['capacity_exceeded', 'resource_conflict', 'duplicate_reservation', 'offering_unavailable', 'lifecycle_violation', 'not_found'] as const) {
      const e = env();
      let calls = 0;
      await expect(retryOnContention(async () => { calls++; throw new SchedulingError(code); }, BACKGROUND_RETRY, e)).rejects.toMatchObject({ code });
      expect(calls, code).toBe(1);
    }
  });

  it('never retries an unknown or raw database error (deadlock, connection loss, bugs)', async () => {
    const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' });
    for (const err of [deadlock, new Error('ECONNRESET'), new TypeError('bug')]) {
      const e = env();
      let calls = 0;
      await expect(retryOnContention(async () => { calls++; throw err; }, BACKGROUND_RETRY, e)).rejects.toBe(err);
      expect(calls).toBe(1);
    }
  });

  it('reports each retry for logging', async () => {
    const seen: number[] = [];
    let calls = 0;
    await retryOnContention(async () => { if (++calls < 2) throw timeout(); }, INTERACTIVE_RETRY, { ...env(), onRetry: i => seen.push(i.attempt) });
    expect(seen).toEqual([1]);
  });
});

describe('backoffDelayMs', () => {
  it('stays inside [0, min(max, base * 2^(attempt-1))) for any random value', () => {
    for (const r of [0, 0.25, 0.999999]) {
      expect(backoffDelayMs(BACKGROUND_RETRY, 1, () => r)).toBeLessThan(500);
      expect(backoffDelayMs(BACKGROUND_RETRY, 2, () => r)).toBeLessThan(1000);
      expect(backoffDelayMs(BACKGROUND_RETRY, 10, () => r)).toBeLessThan(4000); // capped
    }
    expect(backoffDelayMs(BACKGROUND_RETRY, 1, () => 0)).toBe(0);
  });
});

describe('SchedulingError.retryable', () => {
  it('is true for contention_timeout only', () => {
    expect(timeout().retryable).toBe(true);
    for (const code of ['capacity_exceeded', 'resource_conflict', 'conflict', 'invalid_input', 'unsafe_isolation', 'not_found', 'permission_denied'] as const) {
      expect(new SchedulingError(code).retryable, code).toBe(false);
    }
  });
});
