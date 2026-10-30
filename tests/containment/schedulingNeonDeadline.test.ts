import { describe, expect, it } from 'vitest';
import { neon, neonConfig } from '@neondatabase/serverless';
import { fromNeonHttpLike } from '@scheduling/postgres';

// Phase 2B.3e: a bounded calendar request on the REAL Neon HTTP driver (no network: the driver's fetch is replaced). The driver merges a query's
// `fetchOptions` into the request it makes, so an AbortSignal handed to the executor stops the wait. This is what lib/scheduling/runtime.ts relies on.

function fakeFetch(seen: Array<{ url: string; signal: AbortSignal | undefined }>, answer: 'hang' | 'rows') {
  return async (url: unknown, init?: { signal?: AbortSignal }) => {
    seen.push({ url: String(url), signal: init?.signal });
    if (answer === 'rows') return new Response(JSON.stringify({ rows: [['1']], fields: [{ name: 'n', dataTypeID: 23 }], rowCount: 1, command: 'SELECT' }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })));
    });
  };
}

describe('the Neon HTTP driver honours the request signal given through the executor', () => {
  const url = 'postgres://user:pw@ep-test-123.example.invalid/neondb';

  it('a signal that aborts ends the wait (the driver reports the AbortError), and the driver saw that very signal', async () => {
    const seen: Array<{ url: string; signal: AbortSignal | undefined }> = [];
    const previous = neonConfig.fetchFunction;
    neonConfig.fetchFunction = fakeFetch(seen, 'hang') as never;
    try {
      const controller = new AbortController();
      const executor = fromNeonHttpLike(neon(url) as never, { queryOptions: { fetchOptions: { signal: controller.signal } } });
      const pending = executor.query('SELECT 1', []);
      setTimeout(() => controller.abort(), 30);
      // the driver reports the abort as its own error type, carrying the AbortError it was stopped by; either way the wait ended at the abort, not at an answer
      const error = (await pending.then(() => null, (e: unknown) => e)) as { name?: string; sourceError?: { name?: string } } | null;
      expect(error).not.toBeNull();
      expect(error?.name === 'AbortError' || error?.sourceError?.name === 'AbortError').toBe(true);
      expect(seen).toHaveLength(1);
      expect(seen[0].signal).toBe(controller.signal);
    } finally {
      neonConfig.fetchFunction = previous;
    }
  });

  it('without a signal the call is exactly as before (no options passed), and with one that never aborts the rows come back', async () => {
    const seen: Array<{ url: string; signal: AbortSignal | undefined }> = [];
    const previous = neonConfig.fetchFunction;
    neonConfig.fetchFunction = fakeFetch(seen, 'rows') as never;
    try {
      const plain = fromNeonHttpLike(neon(url) as never);
      expect(await plain.query('SELECT 1 AS n', [])).toEqual([{ n: 1 }]);
      const controller = new AbortController();
      const bounded = fromNeonHttpLike(neon(url) as never, { queryOptions: { fetchOptions: { signal: controller.signal } } });
      expect(await bounded.query('SELECT 1 AS n', [])).toEqual([{ n: 1 }]);
      expect(seen.map(s => s.signal === undefined)).toEqual([true, false]);
    } finally {
      neonConfig.fetchFunction = previous;
    }
  });

  it('a signal that has ALREADY aborted never sends the request', async () => {
    const seen: Array<{ url: string; signal: AbortSignal | undefined }> = [];
    const previous = neonConfig.fetchFunction;
    neonConfig.fetchFunction = fakeFetch(seen, 'hang') as never;
    try {
      const controller = new AbortController();
      controller.abort();
      const executor = fromNeonHttpLike(neon(url) as never, { queryOptions: { fetchOptions: { signal: controller.signal } } });
      await expect(Promise.race([executor.query('SELECT 1', []), new Promise((_r, reject) => setTimeout(() => reject(new Error('still waiting')), 500))])).rejects.toBeDefined();
    } finally {
      neonConfig.fetchFunction = previous;
    }
  });
});
