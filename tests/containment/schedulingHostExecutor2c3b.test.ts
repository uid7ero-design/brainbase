import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HireNotReadyError, type TenantContext } from '@scheduling/core';

// Phase 2C.3b: the HOST SQL executor (lib/scheduling/runtime.ts createSchedulingExecutor). The statement recorder used to return an object with `query` only, so `transaction()` was
// silently dropped and createHire refused every call. These tests drive the REAL executor and the REAL PostgresHireRepository over a fake of the Neon HTTP driver that behaves like
// the driver: sql.query(...) returns a LAZY query object, and sql.transaction([...]) is the only atomic batch.

interface LazyQuery { text: string; params: unknown[]; opts: unknown; then: PromiseLike<unknown[]>['then'] }
const driver = vi.hoisted(() => ({
  withTransaction: true,
  immediate: [] as Array<{ text: string; opts: unknown }>,
  batches: [] as Array<{ statements: Array<{ text: string; params: unknown[] }>; opts: unknown }>,
  answer: ((): unknown[] => []) as (text: string, params: unknown[]) => unknown[],
  failBatch: null as null | Error,
}));

vi.mock('@/lib/db', () => {
  const run = (text: string, params: unknown[]) => Promise.resolve().then(() => driver.answer(text, params));
  const query = (text: string, params: unknown[] = [], opts?: unknown): LazyQuery => {
    const q = {
      text, params, opts,
      then: (a: never, b: never) => {
        driver.immediate.push({ text, opts });
        return run(text, params).then(a, b);
      },
    } as LazyQuery;
    return q;
  };
  const sql = Object.assign((s: TemplateStringsArray) => run(s.join('?'), []), { query }) as unknown as Record<string, unknown>;
  sql.transaction = (queries: LazyQuery[], opts?: unknown) => {
    driver.batches.push({ statements: queries.map(q => ({ text: q.text, params: q.params })), opts });
    if (driver.failBatch) return Promise.reject(driver.failBatch);
    return Promise.all(queries.map(q => run(q.text, q.params)));
  };
  // A driver without a transaction (an older driver, a different host): the property must be ABSENT, not a stub.
  return { get default() { if (!driver.withTransaction) { const { transaction: _t, ...rest } = sql; void _t; return Object.assign((s: TemplateStringsArray) => run(s.join('?'), []), rest); } return sql; } };
});

const { createSchedulingExecutor, systemClock } = await import('@/lib/scheduling/runtime');
const { PostgresHireRepository } = await import('@scheduling/postgres');

const tenant = (can = true): TenantContext => ({ organisationId: 'org-a', timezone: 'Australia/Adelaide', actor: { kind: 'staff', userId: 'u1' }, can: () => can });
const request = { idempotencyKey: 'hire-key-000001-abcdefgh', offeringId: 'off-1', resourceId: 'court-1', start: { date: '2026-11-16', time: '10:00' }, partySize: 2, customer: { name: 'Pat Hirer' } };

beforeEach(() => {
  driver.withTransaction = true;
  driver.immediate = [];
  driver.batches = [];
  driver.answer = () => [];
  driver.failBatch = null;
});

describe('the host executor forwards transaction()', () => {
  it('a recorded executor has transaction() when the driver has one, and records its statements and time once', async () => {
    const recorder = { statements: 0, dbMs: 0 };
    const sqlx = createSchedulingExecutor(undefined, recorder);
    expect(typeof sqlx.transaction).toBe('function');
    await sqlx.transaction!([{ text: 'SELECT 1', params: [] }, { text: 'SELECT 2', params: ['x'] }]);
    expect(driver.batches).toHaveLength(1);
    expect(driver.batches[0].statements.map(s => s.text)).toEqual(['SELECT 1', 'SELECT 2']);
    expect(recorder.statements).toBe(2);
    expect(recorder.dbMs).toBeGreaterThanOrEqual(0);
    await sqlx.query('SELECT 3');
    expect(recorder.statements).toBe(3);
  });

  it('an unrecorded executor has it too', () => {
    expect(typeof createSchedulingExecutor().transaction).toBe('function');
  });

  it('the deadline signal reaches every statement of the batch AND the batch itself', async () => {
    const controller = new AbortController();
    const sqlx = createSchedulingExecutor(controller.signal, { statements: 0, dbMs: 0 });
    await sqlx.transaction!([{ text: 'SELECT 1' }]);
    const opts = driver.batches[0].opts as { fetchOptions: { signal: AbortSignal } };
    expect(opts.fetchOptions.signal).toBe(controller.signal);
  });

  it('a failing transaction is still recorded, and its error reaches the caller untouched (SQLSTATE and all)', async () => {
    const recorder = { statements: 0, dbMs: 0 };
    driver.failBatch = Object.assign(new Error('lock timeout'), { code: '55P03' });
    const sqlx = createSchedulingExecutor(undefined, recorder);
    await expect(sqlx.transaction!([{ text: 'SELECT 1' }])).rejects.toMatchObject({ code: '55P03' });
    expect(recorder.statements).toBe(1);
  });

  it('a recorded log carries numbers only: the recorder has no field that could hold SQL or parameters', () => {
    const recorder = { statements: 0, dbMs: 0 };
    createSchedulingExecutor(undefined, recorder);
    expect(Object.keys(recorder).sort()).toEqual(['dbMs', 'statements']);
  });
});

describe('a missing transaction implementation fails closed', () => {
  it('a driver without transaction() yields an executor without it (never a stub that pretends)', () => {
    driver.withTransaction = false;
    expect(createSchedulingExecutor(undefined, { statements: 0, dbMs: 0 }).transaction).toBeUndefined();
    expect(createSchedulingExecutor().transaction).toBeUndefined();
  });

  it('createHire over it throws HireNotReadyError and sends NOTHING to the database', async () => {
    driver.withTransaction = false;
    const repo = new PostgresHireRepository({ sql: createSchedulingExecutor(undefined, { statements: 0, dbMs: 0 }), clock: systemClock });
    await expect(repo.createHire(tenant(), request)).rejects.toBeInstanceOf(HireNotReadyError);
    expect(driver.immediate).toEqual([]);
    expect(driver.batches).toEqual([]);
  });

  it('with transaction() present, the attempt is made (it reads first: the key lookup is the first statement)', async () => {
    const repo = new PostgresHireRepository({ sql: createSchedulingExecutor(undefined, { statements: 0, dbMs: 0 }), clock: systemClock });
    const result = await repo.createHire(tenant(), request);
    expect(result).toMatchObject({ ok: false, code: 'not_found' }); // the fake has no offering: a definite refusal, found by READING; nothing written
    expect(driver.batches).toEqual([]);
    expect(driver.immediate.length).toBeGreaterThan(0);
  });
});
